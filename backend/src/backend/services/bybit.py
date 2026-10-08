"""Bybit's public kline endpoint: the last 24 hours of a Symbol's Candles.

The only place in the API that calls outside the deployment. Its policy is the
opposite of the notifier's Telegram client on purpose: a person is waiting on
this answer, so there is one attempt and no retries.
"""

import asyncio
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from pydantic import BaseModel, Field, ValidationError

from backend.schemas.candle import CandleRead

KLINE_PATH = "/v5/market/kline"
# Bybit defaults `category` to `linear` — the USDT perpetual future, another
# order book. Our prices come from the spot stream, so without this the chart
# would draw a different market under a Threshold set against spot, and look
# entirely plausible while doing it.
CATEGORY = "spot"
# Minutes as a bare number: "15m" belongs to a different Bybit enum and is a
# parameter error on this endpoint.
INTERVAL = "15"
CANDLES_PER_DAY = 96  # 24 h at 15 min
TIMEOUT_SECONDS = 5.0


class UpstreamError(Exception):
    """Bybit did not give us Candles. The message is for the log, not the client."""


class UpstreamRefusedError(UpstreamError):
    """HTTP 403: an IP ban for breaching the rate limit, or a region block.

    Bybit's documented remedy is to stop calling for at least ten minutes;
    calling again extends the ban.
    """


# startTime (ms), open, high, low, close, volume, turnover — all strings on the wire
_Row = tuple[int, Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]


class _KlineResult(BaseModel):
    # Absent rather than empty on a business error: an unknown symbol answers
    # `result: {}`. Named `rows` because `list: list[...] = None` would bind
    # `list` to None in the class body, and this very annotation would then
    # evaluate `None[...]`.
    rows: list[_Row] | None = Field(default=None, alias="list")


class _Envelope(BaseModel):
    ret_code: int = Field(alias="retCode")
    ret_msg: str = Field(alias="retMsg")
    result: _KlineResult


async def fetch_candles(client: httpx.AsyncClient, symbol: str) -> list[CandleRead]:
    """One attempt at 24 hours of Candles, oldest first.

    Every failure becomes an UpstreamError, so the caller decides what a person
    sees from one kind of exception instead of from httpx's whole hierarchy.
    """
    try:
        # httpx's timeout applies per phase — connect, then each read — so a
        # body that trickles in can take far longer than five seconds in
        # total. This is the deadline the person waiting actually experiences.
        async with asyncio.timeout(TIMEOUT_SECONDS):
            response = await client.get(
                KLINE_PATH,
                params={
                    "category": CATEGORY,
                    "symbol": symbol,
                    "interval": INTERVAL,
                    "limit": CANDLES_PER_DAY,
                },
            )
    except (httpx.HTTPError, TimeoutError) as exc:
        raise UpstreamError(f"transport failed: {exc!r}") from exc

    trace_id = response.headers.get("traceid")  # the id Bybit support asks for

    # Gate 1: the HTTP status. A 403 is the one failure that changes what we
    # do next; `server` tells a CloudFront region block from Bybit's own ban.
    if response.status_code == httpx.codes.FORBIDDEN:
        raise UpstreamRefusedError(
            f"403 from server={response.headers.get('server')} traceid={trace_id}"
        )
    if response.status_code != httpx.codes.OK:
        raise UpstreamError(f"HTTP {response.status_code} traceid={trace_id}")

    # Gate 2: parse without trusting the body. An error body may not be JSON
    # at all — the region block has an unquoted key — so a crash here would
    # turn a diagnosable refusal into a stack trace.
    try:
        envelope = _Envelope.model_validate_json(response.content)
    except ValidationError as exc:
        raise UpstreamError(
            f"unparsable body {response.text[:200]!r} traceid={trace_id}"
        ) from exc

    # Gate 3: Bybit's own verdict. Business errors arrive as HTTP 200.
    if envelope.ret_code != 0 or envelope.result.rows is None:
        raise UpstreamError(
            f"retCode={envelope.ret_code} retMsg={envelope.ret_msg!r} "
            f"traceid={trace_id}"
        )

    # Bybit answers newest first; no chart wants that.
    return [
        CandleRead(
            start=datetime.fromtimestamp(start_ms / 1000, tz=UTC),
            open=open_,
            high=high,
            low=low,
            close=close,
            volume=volume,
            turnover=turnover,
        )
        for start_ms, open_, high, low, close, volume, turnover in reversed(
            envelope.result.rows
        )
    ]
