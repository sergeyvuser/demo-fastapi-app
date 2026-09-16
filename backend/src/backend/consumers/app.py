"""Evaluator: consumes ticks, fires alerts.

Separate process from the API (run via `faststream run`), same codebase —
it reuses models, repositories and services directly.
"""

from faststream import FastStream
from loguru import logger
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from prometheus_client import start_http_server
from redis.asyncio import Redis

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal, engine
from backend.services.alert_evaluation import AlertEvaluationService
from backend.services.prices import PriceCache
from shared.broker import (
    ALERTS_EXCHANGE,
    TICKS_CACHE_QUEUE,
    TICKS_EVALUATOR_QUEUE,
    TICKS_EXCHANGE,
    declare_alerts_topology,
    make_broker,
)
from shared.events import TickEvent
from shared.metrics import EVALUATOR_METRICS_PORT, alerts_fired, ticks_processed
from shared.service import configure_service

configure_service(name="evaluator", settings=settings)

broker = make_broker(settings.rabbitmq)
app = FastStream(broker)

SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
RedisInstrumentor().instrument()

_price_cache: PriceCache | None = None


@app.on_startup
async def startup() -> None:
    global _price_cache
    redis = Redis.from_url(
        settings.redis.url,
        decode_responses=True,
        socket_connect_timeout=settings.redis.connect_timeout,
        socket_timeout=settings.redis.socket_timeout,
    )
    await redis.ping()
    _price_cache = PriceCache(redis)


@app.on_startup
async def start_metrics_server() -> None:
    start_http_server(EVALUATOR_METRICS_PORT)  # for Prometheus /metrics


@app.after_startup
async def declare_topology() -> None:
    # requires a live broker connection
    await declare_alerts_topology(broker=broker)


@broker.subscriber(TICKS_CACHE_QUEUE, TICKS_EXCHANGE)
async def cache_price(tick: TickEvent) -> None:
    """Keep the price cache current. That is the whole job.

    Its own queue, so a failed evaluation cannot redeliver a Tick whose price
    was already written — and a Redis outage cannot reject a Tick whose Alert
    has already fired.
    """
    assert _price_cache is not None  # set in startup hook
    await _price_cache.set(tick.symbol, tick.price, tick.reference_price)


@broker.subscriber(TICKS_EVALUATOR_QUEUE, TICKS_EXCHANGE)
async def on_ticks(tick: TickEvent) -> None:
    async with AsyncSessionLocal() as session:
        events = await AlertEvaluationService(session=session).process_tick(tick=tick)

    for event in events:
        await broker.publish(
            event.model_dump(mode="json"),
            exchange=ALERTS_EXCHANGE,
            routing_key="alert.triggered",
        )
        alerts_fired.labels(event.condition).inc()
        (
            logger.bind(
                alert_id=str(event.alert_id),
                user_id=str(event.user_id),
                threshold=str(event.threshold),
            ).info(
                "alert fired: {} {} at {}",
                event.symbol,
                event.condition,
                event.price,
            )
        )

    ticks_processed.inc()
