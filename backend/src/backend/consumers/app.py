"""Evaluator: consumes ticks, fires alerts.

Separate process from the API (run via `faststream run`), same codebase —
it reuses models, repositories and services directly.
"""

import logging

from faststream import FastStream
from faststream.rabbit import RabbitBroker
from faststream.rabbit.opentelemetry import RabbitTelemetryMiddleware
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
    TICKS_EVALUATOR_QUEUE,
    TICKS_EXCHANGE,
    declare_alerts_topology,
)
from shared.events import TickEvent
from shared.metrics import EVALUATOR_METRICS_PORT, alerts_fired, ticks_processed
from shared.middlewares import CorrelationMiddleware
from shared.service import configure_service

configure_service(name="evaluator", settings=settings)

# noinspection PyTypeChecker
broker = RabbitBroker(
    url=settings.rabbitmq.url,
    log_level=logging.DEBUG,
    # class, not instance: FastStream calls it per message as a builder
    middlewares=[CorrelationMiddleware, RabbitTelemetryMiddleware()],
)
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
