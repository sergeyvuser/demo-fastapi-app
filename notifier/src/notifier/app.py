from faststream import FastStream
from faststream.exceptions import RejectMessage
from faststream.rabbit import RabbitBroker
from loguru import logger
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

broker = RabbitBroker(url=settings.rabbitmq.url)
app = FastStream(broker)

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
        logger.info("alert {} for user without telegram — skipped", event.alert_id)
        return  # ack: nothing to deliver is a handled outcome

    # Idempotency: redeliveries (crash after send, before ack) must not
    # spam the user. SET NX succeeds only for the first processing.
    dedup_key = f"notified:{event.alert_id}:{event.triggered_at.isoformat()}"
    first_time = await _redis.set(dedup_key, "1", nx=True, ex=_DEDUP_TTL_SECONDS)
    if not first_time:
        logger.info("duplicate delivery of {} — skipped", dedup_key)
        return  # ack: already handled earlier

    text = (
        f"🔔 {event.symbol}: price {event.price}\n"
        f"condition: {event.condition} {event.threshold}\n"
        f"at {event.triggered_at:%Y-%m-%d %H:%M:%S %Z}"
    )
    try:
        await _sender.send_message(chat_id=event.telegram_chat_id, text=text)
    except TelegramSendError as exc:
        # We claimed the dedup key but failed to deliver — release it so
        # a redelivery attempt can try again, then dead-letter this one.
        await _redis.delete(dedup_key)
        logger.error("delivery failed, dead-lettering: {}", exc)
        raise RejectMessage from exc
