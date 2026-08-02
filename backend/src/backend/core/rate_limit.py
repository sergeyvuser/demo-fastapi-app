from redis.asyncio import Redis

from backend.core.exceptions import AppError
from shared.metrics import rate_limit_hits


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
            # buffered pipeline commands return the pipeline itself, not a coroutine
            # noinspection PyAsyncCall
            pipe.incr(redis_key)
            # noinspection PyAsyncCall
            pipe.expire(redis_key, self.window, nx=True)
            count, _ = await pipe.execute()
            if count > self.limit:
                ttl = await self.redis.ttl(redis_key)
                rate_limit_hits.labels(self.prefix).inc()
                raise RateLimitExceededError(retry_after=max(ttl, 1))
