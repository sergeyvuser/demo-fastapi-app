from decimal import Decimal

from httpx import AsyncClient
from redis.asyncio import Redis

from backend.services.prices import PriceCache

PRICES = "/api/v1/prices"


async def test_a_cached_price_is_served(
    api_client: AsyncClient, clean_redis: Redis
) -> None:
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("64000.5"))

    response = await api_client.get(f"{PRICES}/btcusdt")  # the route upper-cases

    assert response.status_code == 200
    assert response.json() == {"symbol": "BTCUSDT", "price": "64000.5"}


async def test_a_symbol_without_a_fresh_price_is_not_found(
    api_client: AsyncClient,
) -> None:
    assert (await api_client.get(f"{PRICES}/BTCUSDT")).status_code == 404
