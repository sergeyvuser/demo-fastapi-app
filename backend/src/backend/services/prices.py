from decimal import Decimal

from redis.asyncio import Redis

PRICE_TTL_SECONDS = 60


class PriceCache:
    """Last known price per symbol.

    TTL is essential: a missing key means "no fresh data" — an endpoint
    must say so instead of serving a stale price forever.
    """

    def __init__(self, redis: Redis):
        self.redis = redis

    async def set(self, symbol: str, price: Decimal) -> None:
        await self.redis.set(f"price:{symbol}", str(price), ex=PRICE_TTL_SECONDS)

    async def get(self, symbol: str) -> Decimal | None:
        raw = await self.redis.get(f"price:{symbol}")
        return Decimal(raw) if raw is not None else None
