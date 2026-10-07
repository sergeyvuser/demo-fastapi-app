import secrets
import uuid
from collections.abc import Callable, Generator

import pytest
from httpx import AsyncClient
from loguru import logger
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from redis.asyncio import Redis

from backend.api.v1.routes.auth import REFRESH_COOKIE, REFRESH_COOKIE_PATH
from backend.core.config import settings
from backend.core.verification import (
    TOKEN_BYTES,
    TOKEN_TTL_SECONDS,
    PendingVerification,
    SpentVerification,
    verification_key,
)
from backend.models.user import User

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
REFRESH = "/api/v1/auth/refresh"
VERIFY = "/api/v1/auth/verify"
RESEND = "/api/v1/auth/resend-verification"
ME = "/api/v1/users/me"


async def _login(client: AsyncClient, user: User, password: str) -> str:
    """Sign in; the client's jar now holds the refresh cookie. Returns its value."""
    response = await client.post(
        LOGIN, data={"username": user.email, "password": password}
    )
    assert response.status_code == 200
    return client.cookies[REFRESH_COOKIE]


async def _refresh_with(client: AsyncClient, refresh_token: str):
    """Present one specific refresh token, whatever the jar holds.

    A browser can only ever send the cookie it has; replaying a retired one is
    what an attacker with a stolen copy does, so it is spelled out by hand.
    """
    client.cookies.clear()
    return await client.post(
        REFRESH, headers={"Cookie": f"{REFRESH_COOKIE}={refresh_token}"}
    )


@pytest.fixture
def token() -> str:
    """A fresh token per test.

    Three of the tests below drive the same token into different states, so a
    module-level constant would make this file's result depend on the order
    pytest happens to run them in.
    """
    return secrets.token_urlsafe(TOKEN_BYTES)


async def _seed_pending(redis: Redis, token: str, user_id: uuid.UUID) -> None:
    """Put a live link into Redis the way the mail task would."""
    await redis.set(
        verification_key(token),
        PendingVerification(user_id=user_id).model_dump_json(),
        ex=TOKEN_TTL_SECONDS,
    )


async def test_register_creates_user_and_hands_off_the_email(
    api_client: AsyncClient, enqueued_emails: list[dict]
) -> None:
    response = await api_client.post(
        REGISTER,
        json={
            "username": "alice",
            "email": "Alice@Example.COM",
            "password": "s3cret-password",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alice@example.com"  # NormalizedEmail lowercases
    assert "password" not in body and "hashed_password" not in body
    assert [task["email"] for task in enqueued_emails] == ["alice@example.com"]


async def test_duplicate_email_is_a_conflict(
    api_client: AsyncClient, enqueued_emails: list[dict]
) -> None:
    payload = {
        "username": "alice",
        "email": "a@example.com",
        "password": "s3cret-password",
    }
    await api_client.post(REGISTER, json=payload)

    response = await api_client.post(REGISTER, json={**payload, "username": "bob"})

    assert response.status_code == 409
    # RFC 9457: errors are problem documents, not ad-hoc JSON
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json().keys() >= {"type", "title", "status", "detail", "instance"}


async def test_login_sets_the_refresh_cookie_and_keeps_it_out_of_the_body(
    api_client: AsyncClient, user_with_password: User, password: str
) -> None:
    # OAuth2PasswordRequestForm reads a FORM body, not JSON — hence data=
    response = await api_client.post(
        LOGIN, data={"username": user_with_password.email, "password": password}
    )

    assert response.status_code == 200
    assert response.json().keys() == {"access_token", "token_type"}
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith(f"{REFRESH_COOKIE}=")
    for attribute in (
        "httponly",
        "secure",
        "samesite=strict",
        f"path={REFRESH_COOKIE_PATH}",
        f"max-age={settings.auth.refresh_token_ttl_days * 24 * 60 * 60}",
    ):
        assert attribute in cookie


async def test_wrong_password_is_unauthorized(
    api_client: AsyncClient, user_with_password: User
) -> None:
    response = await api_client.post(
        LOGIN, data={"username": user_with_password.email, "password": "wrong"}
    )

    assert response.status_code == 401


async def test_repeated_failures_hit_the_rate_limiter(
    api_client: AsyncClient, user_with_password: User
) -> None:
    creds = {"username": user_with_password.email, "password": "wrong"}
    for _ in range(settings.auth.login_rate_limit):
        assert (await api_client.post(LOGIN, data=creds)).status_code == 401

    response = await api_client.post(LOGIN, data=creds)

    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


async def test_repeated_registrations_hit_the_rate_limiter(
    api_client: AsyncClient, enqueued_emails: list[dict]
) -> None:
    # the register limiter keys on the client ip ALONE: distinct emails share
    # one bucket, and that sharing is the property under test
    for i in range(settings.auth.register_rate_limit):
        response = await api_client.post(
            REGISTER,
            json={
                "username": f"user-{i}",
                "email": f"user-{i}@example.com",
                "password": "s3cret-password",
            },
        )
        assert response.status_code == 201

    refused = await api_client.post(
        REGISTER,
        json={
            "username": "one-too-many",
            "email": "one-too-many@example.com",
            "password": "s3cret-password",
        },
    )

    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0


async def test_refresh_replaces_the_cookie(
    api_client: AsyncClient, user_with_password: User, password: str
) -> None:
    issued = await _login(api_client, user_with_password, password)

    response = await api_client.post(REFRESH)  # the jar sends the cookie itself

    assert response.status_code == 200
    assert response.json().keys() == {"access_token", "token_type"}
    # unobservable while the token travelled in bodies: the jar holds exactly
    # one cookie by that name, and it is no longer the one login issued
    assert api_client.cookies[REFRESH_COOKIE] != issued


async def test_refresh_without_a_cookie_is_unauthorized(
    api_client: AsyncClient,
) -> None:
    assert (await api_client.post(REFRESH)).status_code == 401


async def test_replaying_a_rotated_refresh_token_kills_the_family(
    api_client: AsyncClient, user_with_password: User, password: str
) -> None:
    issued = await _login(api_client, user_with_password, password)
    assert (await api_client.post(REFRESH)).status_code == 200
    fresh = api_client.cookies[REFRESH_COOKIE]

    # presenting the retired token means it leaked: revoke everything
    assert (await _refresh_with(api_client, issued)).status_code == 401
    # ...including the token that was legitimately issued a moment ago
    assert (await _refresh_with(api_client, fresh)).status_code == 401


async def test_logout_revokes_and_clears_the_refresh_cookie(
    api_client: AsyncClient,
    user_with_password: User,
    password: str,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    issued = await _login(api_client, user_with_password, password)

    response = await api_client.post(LOGOUT, headers=auth_headers(user_with_password))

    assert response.status_code == 204
    assert REFRESH_COOKIE not in api_client.cookies
    # cleared in the browser is not enough: a copy taken earlier must be dead too
    assert (await _refresh_with(api_client, issued)).status_code == 401


async def test_logout_requires_a_session(api_client: AsyncClient) -> None:
    assert (await api_client.post(LOGOUT)).status_code == 401


async def test_an_access_token_issued_before_logout_is_rejected(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    headers = auth_headers(user)
    assert (await api_client.get(ME, headers=headers)).status_code == 200

    assert (await api_client.post(LOGOUT, headers=headers)).status_code == 204

    # the same token, still well inside its 15 minutes
    assert (await api_client.get(ME, headers=headers)).status_code == 401


async def test_logout_leaves_other_devices_able_to_refresh(
    api_client: AsyncClient,
    user_with_password: User,
    password: str,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    other_device = await _login(api_client, user_with_password, password)
    await _login(api_client, user_with_password, password)  # this device

    await api_client.post(LOGOUT, headers=auth_headers(user_with_password))

    # revocation is per User for access tokens only; the other device's
    # refresh cookie is its own session, and it carries on
    assert (await _refresh_with(api_client, other_device)).status_code == 200


async def test_verification_marks_the_user(
    api_client: AsyncClient, user: User, redis_client: Redis, token: str
) -> None:
    await _seed_pending(redis_client, token, user.id)

    response = await api_client.post(VERIFY, json={"verification_token": token})

    assert response.status_code == 200
    # the route runs on the test's own session, so the change is visible here
    assert user.is_verified
    key = verification_key(token)
    # the record is not deleted — it becomes the tombstone that tells a second
    # click apart from a link that merely ran out of time
    assert await redis_client.get(key) == SpentVerification().model_dump_json()
    # ...and it inherits the original deadline. Without KEEPTTL the tombstone
    # would have no expiry at all and the key would outlive the process.
    assert 0 < await redis_client.ttl(key) <= TOKEN_TTL_SECONDS


async def test_a_spent_verification_link_cannot_be_used_twice(
    api_client: AsyncClient, user: User, redis_client: Redis, token: str
) -> None:
    await _seed_pending(redis_client, token, user.id)
    body = {"verification_token": token}

    assert (await api_client.post(VERIFY, json=body)).status_code == 200
    second = await api_client.post(VERIFY, json=body)

    # 409 and not 410: the link did work, so the next action is "sign in",
    # not "ask for another letter"
    assert second.status_code == 409


async def test_an_unknown_verification_link_is_gone(
    api_client: AsyncClient, token: str
) -> None:
    # nothing is seeded, which is exactly what an expired token looks like
    # from the server's side: a missing key and a never-issued one are one
    # observation
    response = await api_client.post(VERIFY, json={"verification_token": token})

    assert response.status_code == 410
    # 401 would send the frontend's fetch wrapper off to refresh a session the
    # public verification screen does not have
    assert "www-authenticate" not in response.headers


async def test_a_verification_link_naming_no_user_is_gone(
    api_client: AsyncClient, redis_client: Redis, token: str
) -> None:
    await _seed_pending(redis_client, token, uuid.uuid7())

    response = await api_client.post(VERIFY, json={"verification_token": token})

    assert response.status_code == 410


async def test_verification_get_alias_is_gone(
    api_client: AsyncClient, token: str
) -> None:
    response = await api_client.get(f"{VERIFY}?token={token}")
    assert response.status_code == 405
    assert response.headers["allow"] == "POST"


async def test_verification_post_with_token_in_query_is_not_allowed(
    api_client: AsyncClient,
    token: str,
) -> None:
    response = await api_client.post(f"{VERIFY}?token={token}")
    assert response.status_code == 422


async def test_correlation_id_is_echoed(api_client: AsyncClient) -> None:
    response = await api_client.get(
        "/healthz", headers={"X-Request-ID": "given-by-caller"}
    )

    assert response.headers["x-request-id"] == "given-by-caller"


async def test_correlation_id_is_minted_when_absent(api_client: AsyncClient) -> None:
    assert (await api_client.get("/healthz")).headers["x-request-id"]


@pytest.mark.parametrize(
    "malformed",
    [b"short", b"has spaces", b"a" * 65, b"\xff\xfe-not-text"],
    ids=["too-short", "outside-the-alphabet", "too-long", "not-decodable"],
)
async def test_a_malformed_correlation_id_is_replaced(
    api_client: AsyncClient, malformed: bytes
) -> None:
    # bytes on purpose: a header IS bytes, and the last case is not text at all
    response = await api_client.get("/healthz", headers={b"X-Request-ID": malformed})

    used = response.headers["x-request-id"]
    assert used.encode() != malformed
    assert len(used) == 32  # uuid4().hex — minted, not propagated


async def test_resend_requires_a_session(api_client: AsyncClient) -> None:
    assert (await api_client.post(RESEND)).status_code == 401


async def test_resend_hands_off_another_letter(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
    enqueued_emails: list[dict],
) -> None:
    response = await api_client.post(RESEND, headers=auth_headers(user))

    assert response.status_code == 200
    assert [task["email"] for task in enqueued_emails] == [user.email]


async def test_resend_refuses_an_already_verified_account(
    api_client: AsyncClient,
    verified_user: User,
    auth_headers: Callable[[User], dict[str, str]],
    enqueued_emails: list[dict],
) -> None:
    response = await api_client.post(RESEND, headers=auth_headers(verified_user))

    assert response.status_code == 409
    # not merely refused on the way back: the letter is never handed over
    assert enqueued_emails == []


async def test_repeated_resends_hit_the_rate_limiter(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
    enqueued_emails: list[dict],
    redis_client: Redis,
) -> None:
    headers = auth_headers(user)
    for _ in range(settings.auth.verification_rate_limit):
        assert (await api_client.post(RESEND, headers=headers)).status_code == 200

    refused = await api_client.post(RESEND, headers=headers)

    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0
    # the bucket is the address and nothing else — an IP in the key would hand
    # the same person a fresh allowance from every network they sign in from
    assert await redis_client.exists(f"ratelimit:verification-resend:{user.email}")


@pytest.fixture(scope="session")
def _span_exporter() -> InMemorySpanExporter:
    """Make the application's own spans readable in-process.

    `FastAPIInstrumentor` was applied at import time against the GLOBAL tracer
    provider, and what it kept is a ProxyTracer — one that resolves to
    whatever provider is installed later. So installing one here, long after
    instrumentation, is enough to start receiving spans.

    Session-scoped because `set_tracer_provider` takes effect once per
    process: a second call is ignored with a warning. The cost is that every
    later test also produces real spans into this exporter, which the
    function-scoped fixture below empties before each use.
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return exporter


@pytest.fixture
def spans(_span_exporter: InMemorySpanExporter) -> InMemorySpanExporter:
    # the alias tests deliberately put a token in a query string; starting
    # empty keeps their spans out of this test's assertions
    _span_exporter.clear()
    return _span_exporter


@pytest.fixture
def log_lines() -> Generator[list[str]]:
    """Every loguru record this test produces, serialised to JSON.

    `serialize=True` folds the bound fields into the text, and the bound
    fields are where the request log line keeps the path — the thing at issue.
    """
    lines: list[str] = []
    sink_id = logger.add(lines.append, level="DEBUG", serialize=True)
    yield lines
    logger.remove(sink_id)


async def test_the_verification_token_reaches_no_recorded_url(
    api_client: AsyncClient,
    user: User,
    redis_client: Redis,
    token: str,
    spans: InMemorySpanExporter,
    log_lines: list[str],
) -> None:
    """The token travels in a body, so nothing that records a URL keeps it.

    Both sinks are checked because neither can be redacted afterwards: the
    server span goes to Jaeger and the edge's access log records the request
    line. Both read the URL, which is why the token stopped being a query
    parameter. Note what this does NOT claim — the instrumentation records
    `http.url` before routing, so a caller who puts a token in a query string
    still leaks it. What is proved here is that our own call does not.
    """
    await _seed_pending(redis_client, token, user.id)

    response = await api_client.post(VERIFY, json={"verification_token": token})

    assert response.status_code == 200
    assert token not in str(response.request.url)

    recorded = [span for span in spans.get_finished_spans() if span.attributes]
    # guard the guard: with nothing captured, every assertion below passes
    # while proving nothing at all
    assert any(span.attributes.get("http.route") == VERIFY for span in recorded)
    assert not [
        (span.name, key, value)
        for span in recorded
        for key, value in span.attributes.items()
        if token in str(value)
    ]

    assert any("request handled" in line for line in log_lines)
    assert not [line for line in log_lines if token in line]
