from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Trigger
from backend.models.alert import AlertCondition
from backend.models.trigger import TriggerDelivery
from backend.schemas.alert import AlertUpdate
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


async def triggers_of(session: AsyncSession, alert_id) -> list[Trigger]:
    stmt = select(Trigger).where(Trigger.alert_id == alert_id)
    return list(await session.scalars(stmt))


async def test_a_firing_leaves_a_trigger_row_behind(
    session, user, alert_factory
) -> None:
    alert = await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )

    events = await AlertEvaluationService(session).process_tick(make_tick("101"))

    # Unpack and assert that the collection contains exactly one item
    # Expect and unpack exactly one trigger associated with the alert
    [trigger] = await triggers_of(session, alert.id)
    assert trigger.user_id == user.id
    assert trigger.symbol == "BTCUSDT"
    assert trigger.condition is AlertCondition.PRICE_ABOVE
    assert trigger.threshold == Decimal("100")
    assert trigger.price == Decimal("101")
    assert trigger.delivery is TriggerDelivery.QUEUED  # the fixture user has a chat
    # the event names the row, so the socket can dedupe against the feed
    assert events[0].trigger_id == trigger.id

    # incremented as a SQL expression, so the attribute is expired until refreshed
    await session.refresh(alert)
    assert alert.trigger_count == 1


async def test_a_user_without_a_chat_gets_no_chat(
    session, other_user, alert_factory
) -> None:
    alert = await AlertService(session).create(
        user_id=other_user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )

    await AlertEvaluationService(session).process_tick(make_tick("101"))

    [trigger] = await triggers_of(session, alert.id)
    assert trigger.delivery is TriggerDelivery.NO_CHAT


async def test_editing_the_threshold_does_not_rewrite_history(
    session, user, alert_factory
) -> None:
    alert = await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )
    await AlertEvaluationService(session).process_tick(make_tick("101"))

    await AlertService(session).update(
        alert_id=alert.id,
        user_id=user.id,
        data=AlertUpdate(threshold=Decimal("200")),
    )

    [trigger] = await triggers_of(session, alert.id)
    await session.refresh(trigger)  # read what the database holds, not the identity map
    assert trigger.threshold == Decimal("100")


async def test_deleting_an_alert_deletes_its_triggers(
    session, user, alert_factory
) -> None:
    alert = await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )
    await AlertEvaluationService(session).process_tick(make_tick("101"))

    await AlertService(session).delete(alert_id=alert.id, user_id=user.id)

    # the database cascade does this, not the ORM: Alert has no relationship to Trigger
    remaining = await session.scalar(
        select(func.count()).select_from(Trigger).where(Trigger.alert_id == alert.id)
    )
    assert remaining == 0
