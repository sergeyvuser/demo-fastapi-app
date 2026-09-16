from collections.abc import Sequence
from decimal import Decimal
from typing import NamedTuple, cast

from redis.asyncio import Redis

PRICE_TTL_SECONDS = 60


class CachedPrice(NamedTuple):
    """What the cache knows about one Symbol right now.

    The halves go missing independently: `last` expires a minute after the
    final Tick, `reference` is absent until a Tick carrying one arrives.
    """

    last: Decimal | None
    reference: Decimal | None


def _price_key(symbol: str) -> str:
    return f"price:{symbol}"


def _reference_key(symbol: str) -> str:
    return f"price24h:{symbol}"


def _as_decimal(raw: str | None) -> Decimal | None:
    return Decimal(raw) if raw is not None else None


class PriceCache:
    """Last known price per symbol.

    TTL is essential: a missing key means "no fresh data" — an endpoint
    must say so instead of serving a stale price forever.

    Two keys rather than one JSON value: `price:{SYMBOL}` is a bare decimal
    string that three services already agree on, and a second number is not
    a reason to rewrite a format everybody reads.
    """

    def __init__(self, redis: Redis):
        self.redis = redis

    async def set(
        self, symbol: str, price: Decimal, reference: Decimal | None = None
    ) -> None:
        # One round trip on the cache subscriber's hot path: every Tick lands here.
        async with self.redis.pipeline(transaction=True) as pipe:
            # buffered pipeline commands return the pipeline, not a coroutine
            # noinspection PyAsyncCall
            pipe.set(_price_key(symbol=symbol), str(price), ex=PRICE_TTL_SECONDS)
            if reference is not None:
                # noinspection PyAsyncCall
                pipe.set(
                    _reference_key(symbol=symbol), str(reference), ex=PRICE_TTL_SECONDS
                )
            await pipe.execute()

    async def get(self, symbol: str) -> Decimal | None:
        # decode_responses=True on the client: values are str, the stubs say bytes|str
        return _as_decimal(cast("str | None", await self.redis.get(_price_key(symbol))))

    async def get_many(self, symbols: Sequence[str]) -> dict[str, CachedPrice]:
        """Both prices for every Symbol, in one round trip.

        MGET answers in the order asked and puts None where a key is absent,
        so the two halves line up with `symbols` by position.
        """
        if not symbols:
            return {}  # MGET with no keys is an error, not an empty answer
        keys = [_price_key(s) for s in symbols] + [_reference_key(s) for s in symbols]
        raw = cast("list[str | None]", await self.redis.mget(keys))
        half = len(symbols)
        return {
            symbol: CachedPrice(_as_decimal(last), _as_decimal(reference))
            for symbol, last, reference in zip(
                symbols, raw[:half], raw[half:], strict=True
            )
        }
