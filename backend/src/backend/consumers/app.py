"""Evaluator: consumes ticks, fires alerts.

Separate process from the API (run via `faststream run`), same codebase —
it reuses models, repositories and services directly.
"""

from faststream import FastStream
from faststream.rabbit import RabbitBroker
from loguru import logger
from redis.asyncio import Redis
from shared.broker import (
    ALERTS_EXCHANGE,
    ALERTS_TRIGGERED_QUEUE,
    TICKS_EVALUATOR_QUEUE,
    TICKS_EXCHANGE,
)
from shared.events import TickEvent

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal
from backend.services.alert_evaluation import AlertEvaluationService
from backend.services.prices import PriceCache

broker = RabbitBroker(settings.rabbitmq.url)
app = FastStream(broker)

_price_cache: PriceCache | None = None


@app.on_startup
async def startup() -> None:
    global _price_cache
    redis = Redis.from_url(
        settings.redis.url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
    await redis.ping()
    _price_cache = PriceCache(redis)


@app.on_startup
async def declare_alerts_topology() -> None:
    # The alerts exchange is ours to publish into, but no subscriber in
    # this process declares it. Declare exchange + queue + binding
    # explicitly so triggered alerts are retained even while the
    # notifier service does not exist / is down.
    exchange = await broker.declare_exchange(ALERTS_EXCHANGE)
    queue = await broker.declare_queue(ALERTS_TRIGGERED_QUEUE)
    await queue.bind(exchange, routing_key="alert.triggered")


@broker.subscriber(TICKS_EVALUATOR_QUEUE, TICKS_EXCHANGE)
async def on_ticks(tick: TickEvent) -> None:
    assert _price_cache is not None  # set in startup hook
    await _price_cache.set(tick.symbol, tick.price)

    async with AsyncSessionLocal() as session:
        events = await AlertEvaluationService(session=session).process_tick(tick=tick)

    for event in events:
        await broker.publish(
            event.model_dump(mode="json"),
            exchange=ALERTS_EXCHANGE,
            routing_key="alert.triggered",
        )
        logger.info(
            "alert fired: {} {} at {}",
            event.symbol,
            event.condition,
            event.price,
        )
