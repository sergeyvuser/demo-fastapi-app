from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Alert
from backend.models.alert import AlertCondition
from backend.repositories.alert import AlertRepository
from shared.events import AlertTriggeredEvent, TickEvent


class AlertEvaluationService:
    """Decides which alerts fire on a given tick.

    Owns the transaction: last_triggered_at updates are committed here.
    Publishing the events is the caller's job (consumer) — keep broker
    I/O out of the service so it stays testable without RabbitMQ.
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.alerts = AlertRepository(session)

    async def process_tick(self, tick: TickEvent) -> list[AlertTriggeredEvent]:
        events: list[AlertTriggeredEvent] = []
        now = datetime.now(UTC)

        for alert in await self.alerts.get_active_for_symbol(tick.symbol):
            if not self._condition_met(alert, tick):
                continue
            if self._in_cooldown(alert, now):
                continue
            alert.last_triggered_at = now
            events.append(
                AlertTriggeredEvent(
                    alert_id=alert.id,
                    user_id=alert.user_id,
                    telegram_chat_id=alert.user.telegram_chat_id,
                    symbol=alert.symbol,
                    condition=alert.condition.value,
                    threshold=alert.threshold,
                    price=tick.price,
                    triggered_at=now,
                )
            )

        if events:
            await self.session.commit()
        return events

    @staticmethod
    def _condition_met(alert: Alert, tick: TickEvent) -> bool:
        if alert.condition is AlertCondition.PRICE_ABOVE:
            return tick.price >= alert.threshold
        return tick.price <= alert.threshold

    @staticmethod
    def _in_cooldown(alert: Alert, now: datetime) -> bool:
        if alert.last_triggered_at is None:
            return False
        return (now - alert.last_triggered_at).total_seconds() < alert.cooldown_seconds
