import asyncio
from contextlib import suppress

from faststream import FastStream
from faststream.rabbit import RabbitBroker
from loguru import logger
from shared.broker import TICKS_EXCHANGE

from ingestor.bybit_ws import stream_ticks
from ingestor.config import settings

broker = RabbitBroker(settings.rabbitmq.url)
app = FastStream(broker)

_pump_task: asyncio.Task[None] | None = None


async def _pump() -> None:
    async for tick in stream_ticks(
        settings.stream.ws_url,
        settings.stream.symbols,
        settings.stream.reconnect_delay_seconds,
    ):
        await broker.publish(
            tick.model_dump(mode="json"),
            exchange=TICKS_EXCHANGE,
            routing_key=tick.symbol,
        )


@app.after_startup
async def start_pump() -> None:
    global _pump_task
    await broker.declare_exchange(TICKS_EXCHANGE)
    _pump_task = asyncio.create_task(_pump())
    logger.info("tick pump started")


@app.on_shutdown
async def stop_pump() -> None:
    if _pump_task is not None:
        _pump_task.cancel()
        with suppress(asyncio.CancelledError):
            await _pump_task