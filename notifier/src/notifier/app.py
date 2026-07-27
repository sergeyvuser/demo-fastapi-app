import logging

from faststream import FastStream
from faststream.exceptions import RejectMessage
from faststream.rabbit import RabbitBroker
from faststream.rabbit.opentelemetry import RabbitTelemetryMiddleware
from loguru import logger
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from prometheus_client import start_http_server
from redis.asyncio import Redis

from notifier.config import settings
from notifier.telegram import TelegramSender, TelegramSendError
from shared.broker import (
    ALERTS_DEAD_QUEUE,
    ALERTS_DLX,
    ALERTS_EXCHANGE,
    ALERTS_TRIGGERED_QUEUE,
)
from shared.events import AlertTriggeredEvent
from shared.logging import configure_logging
from shared.metrics import notifications_failed, notifications_sent
from shared.middlewares import CorrelationMiddleware
from shared.tracing import configure_tracing

configure_logging(settings.log)
configure_tracing("notifier", settings.otel)

# noinspection PyTypeChecker
broker = RabbitBroker(
    url=settings.rabbitmq.url,
    log_level=logging.WARNING,
    # class, not instance: FastStream calls it per message as a builder
    middlewares=[CorrelationMiddleware, RabbitTelemetryMiddleware()],
)
app = FastStream(broker)

HTTPXClientInstrumentor().instrument()
RedisInstrumentor().instrument()

_redis: Redis | None = None
_sender: TelegramSender | None = None

_DEDUP_TTL_SECONDS = 6 * 3600


@app.on_startup
async def startup() -> None:
    global _redis, _sender
    _redis = Redis.from_url(
        url=settings.redis.url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
    await _redis.ping()
    _sender = TelegramSender(settings.telegram.bot_token.get_secret_value())


@app.on_startup
async def start_metrics_server() -> None:
    start_http_server(9102)  # for Prometheus /metrics


@app.after_startup
async def declare_alerts_topology() -> None:
    # Dead-letter path. Must exist BEFORE the first reject happens:
    # dead-lettering into a missing exchange is a SILENT no-op — the
    # broker just drops the message, no error anywhere.
    dlx = await broker.declare_exchange(ALERTS_DLX)
    dead_queue = await broker.declare_queue(ALERTS_DEAD_QUEUE)
    await dead_queue.bind(dlx)  # fanout ignores routing keys


@app.on_shutdown
async def shutdown() -> None:
    if _sender:
        await _sender.aclose()
    if _redis:
        await _redis.aclose()


@broker.subscriber(ALERTS_TRIGGERED_QUEUE, ALERTS_EXCHANGE)
async def on_alert(event: AlertTriggeredEvent) -> None:
    assert _redis is not None and _sender is not None

    if event.telegram_chat_id is None:
        logger.bind(
            alert_id=str(event.alert_id),
            user_id=str(event.user_id),
        ).info("alert skipped: yser has no telegram")
        return  # ack: nothing to deliver is a handled outcome

    # Idempotency: redeliveries (crash after send, before ack) must not
    # spam the user. SET NX succeeds only for the first processing.
    dedup_key = f"notified:{event.alert_id}:{event.triggered_at.isoformat()}"
    first_time = await _redis.set(dedup_key, "1", nx=True, ex=_DEDUP_TTL_SECONDS)
    if not first_time:
        logger.bind(
            alert_id=str(event.alert_id),
            dedup_key=dedup_key,
        ).info("duplicate delivery - skipped")
        return  # ack: already handled earlier

    text = (
        f"🔔 {event.symbol}: price {event.price}\n"
        f"condition: {event.condition} {event.threshold}\n"
        f"at {event.triggered_at:%Y-%m-%d %H:%M:%S %Z}"
    )
    try:
        await _sender.send_message(chat_id=event.telegram_chat_id, text=text)
        logger.bind(
            alert_id=str(event.alert_id),
            chat_id=event.telegram_chat_id,
        ).info("notification delivered")
        notifications_sent.inc()
    except TelegramSendError as exc:
        # We claimed the dedup key but failed to deliver — release it so
        # a redelivery attempt can try again, then dead-letter this one.
        await _redis.delete(dedup_key)
        logger.bind(
            alert_id=str(event.alert_id),
            user_id=str(event.user_id),
            chat_id=event.telegram_chat_id,
        ).error("delivery failed, dead-lettering: {}", exc)
        notifications_failed.inc()
        raise RejectMessage from exc
