"""The candles endpoint against a fake Bybit.

`httpx.MockTransport` stands in for the network: its handler answers whatever
the test told it to and records every request it saw, which is how "no request
was made" becomes an assertion rather than a hope.

Time does not pass in these tests. Where the minute between upstream calls
matters, the test deletes the marker that stands for it — the TTL is Redis's
job, and Redis is real here.
"""

from collections.abc import AsyncGenerator, Callable

import httpx
import pytest
from httpx import AsyncClient
from redis.asyncio import Redis

from backend.core.config import settings
from backend.main import app as fastapi_app
from backend.models import User

SYMBOL = "BTCUSDT"
CANDLES = f"/api/v1/symbols/{SYMBOL}/candles"

# Two rows exactly as Bybit sends them: positional strings, newest first.
NEWER = ["1789210800000", "77331.1", "77352.6", "77307.3", "77321.1", "16.7", "1293432"]
OLDER = ["1789209900000", "77367.5", "77381.5", "77306.8", "77331.1", "20.0", "1547359"]

# What the region block really looks like: written by CloudFront, not by Bybit,
# and not valid JSON — the key is unquoted.
CLOUDFRONT_BLOCK = (
    "{\n    error:The Amazon CloudFront distribution is configured to block "
    "access from your country\n}"
)


def kline(rows: list[list[str]], ret_code: int = 0, ret_msg: str = "OK") -> dict:
    result = {"category": "spot", "symbol": SYMBOL, "list": rows} if rows else {}
    return {
        "retCode": ret_code,
        "retMsg": ret_msg,
        "result": result,
        "retExtInfo": {},
        "time": 1789211625000,
    }


class FakeBybit:
    """A stand-in for api.bybit.com that remembers what it was asked."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.reply: Callable[[httpx.Request], httpx.Response] = lambda _: (
            httpx.Response(200, json=kline([NEWER, OLDER]))
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.reply(request)


@pytest.fixture
async def bybit(api_client: AsyncClient) -> AsyncGenerator[FakeBybit]:
    """Put a fake Bybit where the lifespan would have put the real client.

    Depends on `api_client` for the order only: that fixture prepares the app,
    this one adds the piece it does not know about.
    """
    fake = FakeBybit()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(fake.handle),
        base_url="https://api.bybit.test",
    ) as client:
        fastapi_app.state.bybit = client
        yield fake


@pytest.fixture
def get_candles(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> Callable[..., object]:
    async def _get(path: str = CANDLES) -> httpx.Response:
        return await api_client.get(path, headers=auth_headers(user))

    return _get


def _times_out(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("no answer", request=request)


async def test_a_session_is_required(api_client: AsyncClient, bybit: FakeBybit) -> None:
    response = await api_client.get(CANDLES)

    assert response.status_code == 401
    assert bybit.requests == []


async def test_a_symbol_outside_the_subscription_is_refused_without_asking_bybit(
    get_candles, bybit: FakeBybit
) -> None:
    response = await get_candles("/api/v1/symbols/DOGEUSDT/candles")

    assert response.status_code == 404
    assert bybit.requests == []


async def test_the_day_is_served_oldest_first_with_named_fields(
    get_candles, bybit: FakeBybit
) -> None:
    response = await get_candles()

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["start"] for item in items] == [
        "2026-09-12T10:45:00Z",
        "2026-09-12T11:00:00Z",
    ]
    assert items[0] == {
        "start": "2026-09-12T10:45:00Z",
        "open": "77367.5",
        "high": "77381.5",
        "low": "77306.8",
        "close": "77331.1",
        "volume": "20.0",
        "turnover": "1547359",
    }


async def test_the_market_and_the_window_are_pinned_server_side(
    get_candles, bybit: FakeBybit
) -> None:
    await get_candles()

    (request,) = bybit.requests
    assert request.url.path == "/v5/market/kline"
    # spot, not Bybit's default `linear` — a different market's prices
    assert dict(request.url.params) == {
        "category": "spot",
        "symbol": SYMBOL,
        "interval": "15",
        "limit": "96",
    }


async def test_a_second_request_within_the_minute_is_served_from_the_cache(
    get_candles, bybit: FakeBybit
) -> None:
    first = await get_candles()
    second = await get_candles()

    assert second.json() == first.json()
    assert len(bybit.requests) == 1


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param(lambda _: httpx.Response(500, text="oops"), id="gate-1-http-500"),
        pytest.param(
            lambda _: httpx.Response(200, text=CLOUDFRONT_BLOCK), id="gate-2-not-json"
        ),
        pytest.param(
            lambda _: httpx.Response(
                200, json=kline([], ret_code=10001, ret_msg="Not supported symbols")
            ),
            id="gate-3-retcode",
        ),
        pytest.param(_times_out, id="timeout"),
    ],
)
async def test_a_failure_with_nothing_cached_is_a_503_after_one_attempt(
    get_candles, bybit: FakeBybit, reply
) -> None:
    bybit.reply = reply

    response = await get_candles()

    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert len(bybit.requests) == 1  # one attempt, no retries


async def test_a_failure_with_candles_cached_serves_them(
    get_candles, bybit: FakeBybit, clean_redis: Redis
) -> None:
    good = await get_candles()
    await clean_redis.delete(f"candles:checked:{SYMBOL}")  # the minute passes
    bybit.reply = lambda _: httpx.Response(502, text="bad gateway")

    stale = await get_candles()

    assert stale.status_code == 200
    assert stale.json() == good.json()
    assert len(bybit.requests) == 2  # it did ask, and fell back


async def test_a_failure_holds_off_the_next_call_for_the_same_minute(
    get_candles, bybit: FakeBybit
) -> None:
    """The once-a-minute bound holds during an outage, not only when it is calm."""
    bybit.reply = lambda _: httpx.Response(500, text="oops")

    await get_candles()
    again = await get_candles()

    assert again.status_code == 503
    assert len(bybit.requests) == 1


async def test_a_403_opens_a_circuit_that_no_symbol_gets_past(
    get_candles, bybit: FakeBybit
) -> None:
    bybit.reply = lambda _: httpx.Response(
        403, text=CLOUDFRONT_BLOCK, headers={"server": "CloudFront"}
    )

    first = await get_candles()
    # Another Symbol, never asked about: the ban is per IP, not per Symbol.
    other = await get_candles("/api/v1/symbols/ETHUSDT/candles")

    assert first.status_code == 503
    assert first.headers["retry-after"] == "600"
    assert other.status_code == 503
    assert 0 < int(other.headers["retry-after"]) <= 600
    assert len(bybit.requests) == 1


async def test_the_limit_answers_429(
    get_candles, bybit: FakeBybit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.candles, "rate_limit", 1)

    assert (await get_candles()).status_code == 200
    assert (await get_candles()).status_code == 429


async def test_an_account_is_metered_by_its_id(
    get_candles, bybit: FakeBybit, user: User, clean_redis: Redis
) -> None:
    await get_candles()

    assert await clean_redis.exists(f"ratelimit:candles:user:{user.id}")


async def test_the_demo_account_is_metered_by_address(
    get_candles,
    bybit: FakeBybit,
    user: User,
    clean_redis: Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.demo, "enabled", True)
    monkeypatch.setattr(settings.demo, "email", user.email)

    await get_candles()

    # 127.0.0.1 is the peer address ASGITransport reports by default
    assert await clean_redis.exists("ratelimit:candles:ip:127.0.0.1")
    assert not await clean_redis.exists(f"ratelimit:candles:user:{user.id}")
