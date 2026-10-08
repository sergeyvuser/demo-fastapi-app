"""A day of Candles per Symbol, cached in Redis and shared by every visitor."""

from typing import cast

import httpx
from loguru import logger
from pydantic import TypeAdapter, ValidationError
from redis.asyncio import Redis

from backend.core.exceptions import ServiceUnavailableError
from backend.schemas.candle import CandleRead
from backend.services.bybit import UpstreamError, UpstreamRefusedError, fetch_candles

# How often Bybit is asked about one Symbol: at most once a minute, however
# many people are watching. The candles supply shape, not price — the live
# price is drawn over them from the socket — and a minute-old shape is right.
CHECK_INTERVAL_SECONDS = 60
# How long the last good answer may still be served while Bybit cannot be
# reached. A day of candles does not spoil in an hour.
STALE_SECONDS = 60 * 60
# Bybit answers a breached IP limit with a 403 and a ban of "at least 10
# minutes", and calling during the ban extends it.
CIRCUIT_SECONDS = 10 * 60

_CIRCUIT_KEY = "candles:circuit"  # one for all Symbols: the ban is per IP

_candles = TypeAdapter(list[CandleRead])


def _data_key(symbol: str) -> str:
    return f"candles:{symbol}"


def _checked_key(symbol: str) -> str:
    return f"candles:checked:{symbol}"


def _parse(raw: str | None) -> list[CandleRead] | None:
    if raw is None:
        return None
    try:
        return _candles.validate_json(raw)
    except ValidationError:
        # Written by the previous release with a different schema. Treat it as
        # a miss: a 500 for up to an hour after every deploy that touches
        # CandleRead is worse than one extra upstream call.
        return None


def _cached_or_unavailable(
    cached: list[CandleRead] | None, *, retry_after: int
) -> list[CandleRead]:
    if cached is None:
        raise ServiceUnavailableError(
            "Price history is temporarily unavailable", retry_after=retry_after
        )
    return cached


class CandleService:
    """Serve the cache; ask Bybit only when it is both stale and allowed.

    Two markers decide whether Bybit may be asked, and the data outlives
    both of them — that difference in lifetimes is what stale-on-error is.
    """

    def __init__(self, redis: Redis, http: httpx.AsyncClient):
        self.redis = redis
        self.http = http

    async def get(self, symbol: str) -> list[CandleRead]:
        # decode_responses=True on the client: values are str, the stubs say bytes|str
        raw, checked, circuit = cast(
            "list[str | None]",
            await self.redis.mget(
                [_data_key(symbol), _checked_key(symbol), _CIRCUIT_KEY]
            ),
        )
        cached = _parse(raw)

        if circuit is not None:
            # silently: a log line per request for ten minutes is noise, the
            # moment the circuit opened has already been logged
            remaining = await self.redis.ttl(_CIRCUIT_KEY)
            return _cached_or_unavailable(cached, retry_after=max(remaining, 1))
        if checked is not None:
            return _cached_or_unavailable(cached, retry_after=CHECK_INTERVAL_SECONDS)

        try:
            candles = await fetch_candles(self.http, symbol)
        except UpstreamRefusedError as exc:
            await self.redis.set(_CIRCUIT_KEY, "open", ex=CIRCUIT_SECONDS)
            logger.bind(symbol=symbol, reason=str(exc)).error("candles circuit opened")
            return _cached_or_unavailable(cached, retry_after=CIRCUIT_SECONDS)
        except UpstreamError as exc:
            # Marked as checked although nothing was fetched: otherwise every
            # request during an outage would call Bybit again, and the
            # once-a-minute bound would vanish exactly when the upstream is
            # struggling.
            await self.redis.set(_checked_key(symbol), "1", ex=CHECK_INTERVAL_SECONDS)
            logger.bind(
                symbol=symbol, reason=str(exc), served_stale=cached is not None
            ).warning("candles upstream failed")
            return _cached_or_unavailable(cached, retry_after=CHECK_INTERVAL_SECONDS)

        async with self.redis.pipeline(transaction=True) as pipe:
            # buffered pipeline commands return the pipeline, not a coroutine
            # noinspection PyAsyncCall
            pipe.set(_data_key(symbol), _candles.dump_json(candles), ex=STALE_SECONDS)
            # noinspection PyAsyncCall
            pipe.set(_checked_key(symbol), "1", ex=CHECK_INTERVAL_SECONDS)
            await pipe.execute()
        return candles
