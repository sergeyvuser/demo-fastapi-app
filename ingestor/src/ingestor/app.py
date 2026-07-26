import asyncio
from contextlib import suppress

from faststream import FastStream
from faststream.rabbit import RabbitBroker
from loguru import logger
from prometheus_client import start_http_server

from ingestor.bybit_ws import stream_ticks
from ingestor.config import settings
from shared.broker import TICKS_EXCHANGE
from shared.metrics import ticks_published

broker = RabbitBroker(settings.rabbitmq.url)
app = FastStream(broker)

_pump_task: asyncio.Task[None] | None = None


async def _pump() -> None:
    """Pump ticks into the broker; survives ANY failure by restarting.

    Bybit WS drops are handled inside stream_ticks; this outer loop
    covers everything else (AMQP outage first of all). CancelledError
    is BaseException and passes through — shutdown still works.
    """
    while True:
        try:
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
                ticks_published.labels(tick.symbol).inc()
        except Exception:
            logger.exception("tick pump crashed; restart in 5s")
            await asyncio.sleep(5)


@app.on_startup
async def start_metrics_server() -> None:
    start_http_server(9100)  # for Prometheus /metrics


@app.after_startup
async def start_pump() -> None:
    global _pump_task
    await broker.declare_exchange(TICKS_EXCHANGE)
    _pump_task = asyncio.create_task(_pump(), name="tick-pump")
    _pump_task.add_done_callback(_log_pump_exit)


def _log_pump_exit(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error("tick pump task exited unexpectedly: {!r}", task.exception())


@app.on_shutdown
async def stop_pump() -> None:
    if _pump_task is not None:
        _pump_task.cancel()
        with suppress(asyncio.CancelledError):
            await _pump_task
