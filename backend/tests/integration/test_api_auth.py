from httpx import AsyncClient
from redis.asyncio import Redis

from backend.core.config import settings
from backend.models.user import User

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
VERIFY = "/api/v1/auth/verify"


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


async def test_login_returns_a_token_pair(
    api_client: AsyncClient, user_with_password: User, password: str
) -> None:
    # OAuth2PasswordRequestForm reads a FORM body, not JSON — hence data=
    response = await api_client.post(
        LOGIN, data={"username": user_with_password.email, "password": password}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]


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


async def test_replaying_a_rotated_refresh_token_kills_the_family(
    api_client: AsyncClient, user_with_password: User, password: str
) -> None:
    pair = (
        await api_client.post(
            LOGIN, data={"username": user_with_password.email, "password": password}
        )
    ).json()

    rotated = await api_client.post(
        REFRESH, json={"refresh_token": pair["refresh_token"]}
    )
    assert rotated.status_code == 200
    fresh = rotated.json()
    assert fresh["refresh_token"] != pair["refresh_token"]

    # presenting the retired token means it leaked: revoke everything
    replayed = await api_client.post(
        REFRESH, json={"refresh_token": pair["refresh_token"]}
    )
    assert replayed.status_code == 401

    # ...including the token that was legitimately issued a moment ago
    after_breach = await api_client.post(
        REFRESH, json={"refresh_token": fresh["refresh_token"]}
    )
    assert after_breach.status_code == 401


async def test_verification_marks_the_user(
    api_client: AsyncClient, user: User, redis_client: Redis
) -> None:
    await redis_client.set(f"verify:{'tok-123'}", str(user.id))

    response = await api_client.get(VERIFY, params={"token": "tok-123"})

    assert response.status_code == 200
    # the route runs on the test's own session, so the change is visible here
    assert user.is_verified
    assert await redis_client.get("verify:tok-123") is None  # one-time token


async def test_correlation_id_is_echoed(api_client: AsyncClient) -> None:
    response = await api_client.get(
        "/healthz", headers={"X-Request-ID": "given-by-caller"}
    )

    assert response.headers["x-request-id"] == "given-by-caller"


async def test_correlation_id_is_minted_when_absent(api_client: AsyncClient) -> None:
    assert (await api_client.get("/healthz")).headers["x-request-id"]
