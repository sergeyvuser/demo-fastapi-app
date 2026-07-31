from datetime import UTC, datetime
from decimal import Decimal

from backend.models.alert import AlertCondition
from backend.services.alert import AlertService
from backend.services.alert_evaluation import AlertEvaluationService
from shared.events import TickEvent


def make_tick(price: str) -> TickEvent:
    return TickEvent(symbol="BTCUSDT", price=Decimal(price), ts=datetime.now(UTC))


async def test_tick_above_threshold_fires_and_then_cools_down(
    session, user, alert_factory
) -> None:
    await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
        ),
    )

    # the service commits inside; the savepoint fixture still rolls it back
    events = await AlertEvaluationService(session).process_tick(tick=make_tick("101"))

    assert len(events) == 1
    assert events[0].price == Decimal("101")
    # the notifier never queries the database — the chat id travels in the event
    assert events[0].telegram_chat_id == user.telegram_chat_id

    assert await AlertEvaluationService(session).process_tick(make_tick("102")) == []


async def test_tick_below_threshold_does_not_fire(session, user, alert_factory) -> None:
    await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
        ),
    )

    assert await AlertEvaluationService(session).process_tick(make_tick("99")) == []


async def test_alerts_of_other_symbols_are_untouched(
    session, user, alert_factory
) -> None:
    await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(symbol="ETHUSDT", threshold=Decimal("1")),
    )

    assert await AlertEvaluationService(session).process_tick(make_tick("999999")) == []
