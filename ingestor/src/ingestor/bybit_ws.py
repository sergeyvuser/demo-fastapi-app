import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal

import aiohttp
from loguru import logger

from shared.events import TickEvent


async def stream_ticks(
    url: str,
    symbols: list[str],
    reconnect_delay: float = 5.0,
) -> AsyncIterator[TickEvent]:
    """Yield ticks from Bybit public spot WS, reconnecting forever.

    The generator never raises on connection loss — it logs and retries.
    Cancellation (task.cancel) is the only way to stop it.
    """
    topics = [f"tickers.{s}" for s in symbols]
    while True:
        try:
            async with (
                aiohttp.ClientSession() as session,
                session.ws_connect(url, heartbeat=20.0) as ws,
            ):
                await ws.send_json({"op": "subscribe", "args": topics})
                logger.info("subscribed: {}", topics)
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        continue
                    payload = msg.json()
                    data = payload.get("data")
                    if not isinstance(data, dict):
                        continue  # subscription acks, pongs, etc.
                    last_price = data.get("lastPrice")
                    if not last_price:
                        continue
                    reference = data.get("prevPrice24h")
                    yield TickEvent(
                        symbol=data["symbol"],
                        price=Decimal(last_price),
                        # Spot tickers are snapshot-only, so this is present on
                        # every message (measured: 40 of 40) — but a field the
                        # colouring wants must never be able to stop the feed.
                        reference_price=Decimal(reference) if reference else None,
                        ts=datetime.fromtimestamp(payload["ts"] / 1000, tz=UTC),
                    )
        except aiohttp.ClientError as exc:
            logger.warning("ws lost ({}); reconnect in {}s", exc, reconnect_delay)
            await asyncio.sleep(reconnect_delay)
