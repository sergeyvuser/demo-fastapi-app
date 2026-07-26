"""Bridge: RabbitMQ → connected WebSocket clients.

Per-instance queues (unique name, auto_delete): a topic exchange copies
each message into EVERY bound queue, so this api instance gets its own
copy of all ticks/alerts without competing with notifier or other
api replicas.
"""

import uuid

from faststream.rabbit import RabbitQueue
from faststream.rabbit.fastapi import RabbitRouter

from backend.api.ws.manager import manager
from backend.core.config import settings
from shared.broker import ALERTS_EXCHANGE, TICKS_EXCHANGE
from shared.events import AlertTriggeredEvent, TickEvent
from shared.middlewares import CorrelationMiddleware

# noinspection PyTypeChecker
stream_router = RabbitRouter(
    url=settings.rabbitmq.url,
    # class, not instance: FastStream calls it per message as a builder
    middlewares=[CorrelationMiddleware],
)

_instance = uuid.uuid4().hex[:8]

_ws_ticks_queue = RabbitQueue(
    f"ticks.ws.{_instance}",
    routing_key="#",
    auto_delete=True,
    exclusive=True,
)

_ws_alerts_queue = RabbitQueue(
    f"alerts.ws.{_instance}",
    routing_key="alert.triggered",
    auto_delete=True,
    exclusive=True,
)


@stream_router.subscriber(_ws_ticks_queue, TICKS_EXCHANGE)
async def on_tick(tick: TickEvent) -> None:
    await manager.broadcast_tick(tick=tick)


@stream_router.subscriber(_ws_alerts_queue, ALERTS_EXCHANGE)
async def on_alert(event: AlertTriggeredEvent) -> None:
    await manager.send_alert(event=event)
