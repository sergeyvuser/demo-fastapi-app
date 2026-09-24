import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Alert, Trigger
from backend.models.alert import AlertCondition
from backend.models.trigger import TriggerDelivery
from backend.repositories.alert import AlertRepository
from backend.repositories.trigger import TriggerRepository
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
        self.triggers = TriggerRepository(session)

    async def process_tick(self, tick: TickEvent) -> list[AlertTriggeredEvent]:
        events: list[AlertTriggeredEvent] = []
        now = datetime.now(UTC)

        for alert in await self.alerts.get_active_for_symbol(tick.symbol):
            if not self._condition_met(alert, tick):
                continue
            # The Python check below and the WHERE inside claim_firing are the
            # same rule read from the same cutoff: the first is a filter that
            # spares a round trip, the second is the one that decides.
            if self._in_cooldown(alert, now):
                continue
            if not await self.alerts.claim_firing(
                alert.id,
                cooldown_cutoff=self._cooldown_cutoff(alert, now),
                now=now,
            ):
                # another Tick of this Symbol got there first
                continue

            # read once, so the stored delivery and the event cannot disagree
            chat_id = alert.user.telegram_chat_id
            trigger = Trigger(
                # the mixin's default runs at flush; the event needs the id now
                id=uuid.uuid7(),
                alert_id=alert.id,
                user_id=alert.user_id,
                symbol=alert.symbol,
                condition=alert.condition,
                threshold=alert.threshold,
                price=tick.price,
                triggered_at=now,
                delivery=(
                    TriggerDelivery.QUEUED
                    if chat_id is not None
                    else TriggerDelivery.NO_CHAT
                ),
            )
            self.triggers.add(trigger)

            # the event publishes the row: built from it, so the Notification
            # and the history cannot tell two different stories
            events.append(
                AlertTriggeredEvent(
                    trigger_id=trigger.id,
                    alert_id=trigger.alert_id,
                    user_id=trigger.user_id,
                    telegram_chat_id=chat_id,
                    symbol=trigger.symbol,
                    condition=trigger.condition.value,
                    threshold=trigger.threshold,
                    price=trigger.price,
                    triggered_at=trigger.triggered_at,
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
    def _cooldown_cutoff(alert: Alert, now: datetime) -> datetime | None:
        """The newest `last_triggered_at` that no longer bars a firing.

        None when the Alert has no Cooldown at all: there is nothing to
        compare against, and therefore nothing to wait for.
        """
        if alert.cooldown_seconds is None:
            return None
        return now - timedelta(seconds=alert.cooldown_seconds)

    @staticmethod
    def _in_cooldown(alert: Alert, now: datetime) -> bool:
        cutoff = AlertEvaluationService._cooldown_cutoff(alert, now)
        if cutoff is None or alert.last_triggered_at is None:
            return False
        return alert.last_triggered_at > cutoff
