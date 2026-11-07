"""The browser trace forwarder against a fake trace store.

`httpx.MockTransport` stands in for Jaeger and records what it was sent.
ASGITransport runs the app to completion, background tasks included, so
"what was forwarded" is already settled when the response comes back — no
sleeping, no polling.
"""

from collections.abc import AsyncGenerator, AsyncIterator, Callable

import httpx
import pytest
from httpx import AsyncClient

from backend.core.config import settings
from backend.main import app as fastapi_app
from backend.models import User

TRACES = "/api/v1/traces"
PROTOBUF = "application/x-protobuf"
# Not OTLP at all: the endpoint must not care.
OPAQUE = b"\x00\xffnot-really-otlp"


class FakeTraceStore:
    """A stand-in for Jaeger's OTLP/HTTP receiver that remembers what it got."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.reply: Callable[[httpx.Request], httpx.Response] = lambda _: (
            httpx.Response(200)
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.reply(request)


@pytest.fixture
async def trace_store(api_client: AsyncClient) -> AsyncGenerator[FakeTraceStore]:
    """Put a fake trace store where the lifespan would have put the real client."""
    fake = FakeTraceStore()
    async with httpx.AsyncClient(transport=httpx.MockTransport(fake.handle)) as client:
        fastapi_app.state.trace_store = client
        yield fake


@pytest.fixture
def export(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> Callable[..., object]:
    # `user` is unverified on purpose: signed in is all this endpoint asks
    async def _export(
        content: bytes | AsyncIterator[bytes] = OPAQUE,
        headers: dict[str, str] | None = None,
        as_user: User | None = None,
    ) -> httpx.Response:
        return await api_client.post(
            TRACES,
            content=content,
            headers=auth_headers(as_user or user)
            | (headers or {"Content-Type": PROTOBUF}),
        )

    return _export


def _refuses(_: httpx.Request) -> httpx.Response:
    return httpx.Response(503, text="busy")


def _unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def _times_out(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("no answer", request=request)


async def test_a_session_is_required(
    api_client: AsyncClient, trace_store: FakeTraceStore
) -> None:
    response = await api_client.post(
        TRACES, content=OPAQUE, headers={"Content-Type": PROTOBUF}
    )

    assert response.status_code == 401
    assert trace_store.requests == []


@pytest.mark.parametrize(
    ("media_type", "answer"),
    [(PROTOBUF, b""), ("application/json", b"{}")],
)
async def test_the_body_is_forwarded_untouched(
    export, trace_store: FakeTraceStore, media_type: str, answer: bytes
) -> None:
    response = await export(headers={"Content-Type": media_type})

    # what an OTLP receiver answers when it accepted everything
    assert response.status_code == 200
    assert response.headers["content-type"] == media_type
    assert response.content == answer
    (forwarded,) = trace_store.requests
    assert str(forwarded.url) == settings.traces.forward_url
    assert forwarded.headers["content-type"] == media_type
    assert forwarded.content == OPAQUE


@pytest.mark.parametrize(
    "failure", [_refuses, _unreachable, _times_out], ids=["5xx", "down", "timeout"]
)
async def test_the_answer_does_not_depend_on_the_trace_store(
    export, trace_store: FakeTraceStore, failure
) -> None:
    accepted = await export()
    trace_store.reply = failure

    failed = await export()

    assert len(trace_store.requests) == 2  # it did try, both times
    assert (
        failed.status_code,
        failed.headers["content-type"],
        failed.content,
    ) == (
        accepted.status_code,
        accepted.headers["content-type"],
        accepted.content,
    )


async def test_a_body_at_the_cap_passes(
    export, trace_store: FakeTraceStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.traces, "max_body_bytes", 16)

    response = await export(content=b"x" * 16)

    assert response.status_code == 200
    assert len(trace_store.requests) == 1


async def test_a_declared_body_over_the_cap_is_refused(
    export, trace_store: FakeTraceStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.traces, "max_body_bytes", 16)

    response = await export(content=b"x" * 17)

    assert response.status_code == 413
    assert response.headers["content-type"] == "application/problem+json"
    assert trace_store.requests == []


async def test_an_undeclared_body_over_the_cap_is_refused(
    export, trace_store: FakeTraceStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.traces, "max_body_bytes", 16)

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(3):
            yield b"x" * 8

    response = await export(content=chunks())

    # the path under test: no size up front, it is learned by reading
    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert trace_store.requests == []


@pytest.mark.parametrize(
    "headers",
    [
        {"Content-Type": "text/plain"},
        {"Content-Type": PROTOBUF, "Content-Encoding": "gzip"},
    ],
    ids=["not-otlp", "compressed"],
)
async def test_a_body_it_cannot_name_or_bound_is_refused(
    export, trace_store: FakeTraceStore, headers: dict[str, str]
) -> None:
    response = await export(headers=headers)

    assert response.status_code == 415
    assert trace_store.requests == []


async def test_the_limit_counts_the_address_not_the_account(
    export,
    trace_store: FakeTraceStore,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.traces, "rate_limit", 1)
    assert (await export()).status_code == 200

    # a second account behind the same address shares the budget
    refused = await export(as_user=other_user)

    assert refused.status_code == 429
    assert "retry-after" in refused.headers
    assert len(trace_store.requests) == 1
