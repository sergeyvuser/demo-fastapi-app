from redis.asyncio import Redis

from backend.core.exceptions import AppError


class RateLimitExceededError(AppError):
    status_code: int = 429
    title: str = "Too many requests"

    def __init__(self, retry_after: int):
        super().__init__(
            detail=f"Too many attempts, retry in {retry_after}s",
            headers={"Retry-After": str(retry_after)},
        )


class FixedWindowRateLimiter:
    """At most `limit` hits per `window` seconds per key.

    Fixed window: the counter lives in a Redis key that expires `window`
    seconds after the FIRST hit. Known weakness: up to 2*limit hits can
    pass around a window boundary — acceptable for login protection.
    """

    def __init__(self, redis: Redis, *, prefix: str, limit: int, window: int):
        self.redis = redis
        self.prefix = prefix
        self.limit = limit
        self.window = window

    async def hit(self, key: str) -> None:
        redis_key = f"ratelimit:{self.prefix}:{key}"
        async with self.redis.pipeline(transaction=True) as pipe:
            count, _ = (
                await pipe.incr(redis_key)
                .expire(redis_key, self.window, nx=True)
                .execute()
            )
            if count > self.limit:
                ttl = await self.redis.ttl(redis_key)
                raise RateLimitExceededError(retry_after=max(ttl, 1))
