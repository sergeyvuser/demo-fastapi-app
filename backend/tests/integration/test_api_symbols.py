from decimal import Decimal

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis

from backend.core.config import settings
from backend.services.prices import PriceCache

SYMBOLS = "/api/v1/symbols"


async def test_every_streamed_symbol_is_listed_with_its_prices(
    api_client: AsyncClient, clean_redis: Redis
) -> None:
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("64000.5"), Decimal("62000"))

    items = {i["symbol"]: i for i in (await api_client.get(SYMBOLS)).json()["items"]}

    assert set(items) == set(settings.subscription.names)
    assert items["BTCUSDT"]["price"] == "64000.5"  # Decimal crosses as a string
    assert items["BTCUSDT"]["reference_price"] == "62000"
    assert items["BTCUSDT"]["precision"] == 1


async def test_a_symbol_without_a_fresh_tick_carries_a_null_price(
    api_client: AsyncClient, clean_redis: Redis
) -> None:
    # only one of the two Symbols has been seen; the other must still be listed
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("64000.5"), Decimal("62000"))

    items = {i["symbol"]: i for i in (await api_client.get(SYMBOLS)).json()["items"]}

    assert items["ETHUSDT"]["price"] is None
    assert items["ETHUSDT"]["reference_price"] is None
    assert items["ETHUSDT"]["precision"] == 2  # configuration, not a Tick


async def test_a_price_without_a_reference_is_still_served(
    api_client: AsyncClient, clean_redis: Redis
) -> None:
    # the reference arrives on every Bybit message, but an older ingestor
    # publishes Ticks without one — the price must not vanish with it
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("64000.5"))

    items = {i["symbol"]: i for i in (await api_client.get(SYMBOLS)).json()["items"]}

    assert items["BTCUSDT"]["price"] == "64000.5"
    assert items["BTCUSDT"]["reference_price"] is None


async def test_the_whole_list_costs_one_round_trip(
    api_client: AsyncClient, clean_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One MGET, not one call per Symbol — the property, not the timing."""
    calls: list[list[str]] = []
    original = clean_redis.mget

    async def spy(keys, *args):
        calls.append(list(keys))
        return await original(keys, *args)

    monkeypatch.setattr(clean_redis, "mget", spy)

    await api_client.get(SYMBOLS)

    assert len(calls) == 1
    assert len(calls[0]) == 2 * len(settings.subscription.names)
