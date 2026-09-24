import asyncio
import uuid
from collections.abc import Generator
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import delete, event, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.core.db import AsyncSessionLocal
from backend.models import Trigger, User
from backend.models.alert import Alert, AlertCondition, AlertRepeatPolicy, AlertStatus
from backend.models.trigger import TriggerDelivery
from backend.schemas.alert import AlertUpdate
from backend.services.alert_evaluation import AlertEvaluationService
from shared.events import AlertTriggeredEvent, TickEvent


def make_tick(price: str) -> TickEvent:
    return TickEvent(symbol="BTCUSDT", price=Decimal(price), ts=datetime.now(UTC))


async def test_tick_above_threshold_fires_and_then_cools_down(
    session, user, alert_factory, alert_service
) -> None:
    await alert_service.create(
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


async def test_tick_below_threshold_does_not_fire(
    session, user, alert_factory, alert_service
) -> None:
    await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
        ),
    )

    assert await AlertEvaluationService(session).process_tick(make_tick("99")) == []


async def test_alerts_of_other_symbols_are_untouched(
    session, user, alert_factory, alert_service
) -> None:
    await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(symbol="ETHUSDT", threshold=Decimal("1")),
    )

    assert await AlertEvaluationService(session).process_tick(make_tick("999999")) == []


async def triggers_of(session: AsyncSession, alert_id) -> list[Trigger]:
    stmt = select(Trigger).where(Trigger.alert_id == alert_id)
    return list(await session.scalars(stmt))


async def test_a_firing_leaves_a_trigger_row_behind(
    session, user, alert_factory, alert_service
) -> None:
    alert = await alert_service.create(
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
    session, other_user, alert_factory, alert_service
) -> None:
    alert = await alert_service.create(
        user_id=other_user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )

    await AlertEvaluationService(session).process_tick(make_tick("101"))

    [trigger] = await triggers_of(session, alert.id)
    assert trigger.delivery is TriggerDelivery.NO_CHAT


async def test_editing_the_threshold_does_not_rewrite_history(
    session, user, alert_factory, alert_service
) -> None:
    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )
    await AlertEvaluationService(session).process_tick(make_tick("101"))

    await alert_service.update(
        alert_id=alert.id,
        user_id=user.id,
        data=AlertUpdate(threshold=Decimal("200")),
    )

    [trigger] = await triggers_of(session, alert.id)
    await session.refresh(trigger)  # read what the database holds, not the identity map
    assert trigger.threshold == Decimal("100")


async def test_deleting_an_alert_deletes_its_triggers(
    session, user, alert_factory, alert_service
) -> None:
    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )
    await AlertEvaluationService(session).process_tick(make_tick("101"))

    await alert_service.delete(alert_id=alert.id, user_id=user.id)

    # the database cascade does this, not the ORM: Alert has no relationship to Trigger
    remaining = await session.scalar(
        select(func.count()).select_from(Trigger).where(Trigger.alert_id == alert.id)
    )
    assert remaining == 0


@pytest.fixture
async def committed_alert(db_engine: AsyncEngine, request):
    """An Alert that is really on disk, visible from every connection.

    The `session` fixture cannot serve a race test: it is one connection
    inside one transaction, and a transaction is invisible to everyone but
    itself — two "concurrent" sessions built on it would be the same session.
    So this fixture commits for real and cleans up after itself; deleting the
    User cascades to the Alert and to any Triggers the test produced.
    """
    policy = getattr(request, "param", AlertRepeatPolicy.WHILE_TRUE)
    suffix = uuid.uuid4().hex[:8]
    async with AsyncSessionLocal(bind=db_engine) as setup:
        user = User(
            username=f"race-{suffix}",
            email=f"race-{suffix}@example.com",
            hashed_password="not-a-real-hash",
            telegram_chat_id=424242,
        )
        setup.add(user)
        await setup.flush()  # assigns the id the Alert needs
        alert = Alert(
            user_id=user.id,
            symbol="RACEUSDT",  # its own Symbol: nothing else can match this Tick
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
            cooldown_seconds=3600,
            repeat_policy=policy,
        )
        setup.add(alert)
        await setup.commit()

    # expire_on_commit=False, so the attributes survive the commit above
    yield alert

    async with AsyncSessionLocal(bind=db_engine) as teardown:
        await teardown.execute(delete(User).where(User.id == alert.user_id))
        await teardown.commit()


@pytest.mark.parametrize("committed_alert", [AlertRepeatPolicy.ONCE], indirect=True)
async def test_two_concurrent_ticks_fire_an_alert_once(
    db_engine: AsyncEngine, committed_alert: Alert
) -> None:
    """The promise `once` makes is the one concurrency breaks first.

    The status change is part of the claim's SET, so the loser's UPDATE finds
    no ACTIVE row and writes nothing.
    """
    tick = TickEvent(
        symbol=committed_alert.symbol, price=Decimal("101"), ts=datetime.now(UTC)
    )

    async def evaluate() -> list[AlertTriggeredEvent]:
        # a session of its own = a connection of its own = a transaction of its own
        async with AsyncSessionLocal(bind=db_engine) as session:
            return await AlertEvaluationService(session).process_tick(tick)

    first, second = await asyncio.gather(evaluate(), evaluate())

    assert len(first) + len(second) == 1

    async with AsyncSessionLocal(bind=db_engine) as check:
        assert len(await triggers_of(check, committed_alert.id)) == 1
        alert = await check.get(Alert, committed_alert.id)
        assert alert is not None and alert.status is AlertStatus.COMPLETED
        assert alert.trigger_count == 1


async def test_an_alert_without_a_cooldown_fires_on_every_tick(session, user) -> None:
    """A NULL Cooldown is no debounce: nothing to wait for between firings.

    Built from the model, not through AlertService: the create schema still
    requires a Cooldown, so until the Repeat policy opens that field this is
    the only way a NULL gets into a row.
    """
    await make_alert_row(session=session, user=user)

    first = await AlertEvaluationService(session).process_tick(make_tick("101"))
    second = await AlertEvaluationService(session).process_tick(make_tick("102"))

    assert len(first) == 1
    assert len(second) == 1


@pytest.fixture
def updates_to_alerts(db_engine: AsyncEngine) -> Generator[list[str]]:
    """Every UPDATE against `alerts` that actually reaches the database.

    "Written only on transitions" is a claim about statements, not about
    values, so the only honest way to pin it is to count statements.
    """
    seen: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        if statement.lstrip().upper().startswith("UPDATE ALERTS"):
            seen.append(statement)

    event.listen(db_engine.sync_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine.sync_engine, "before_cursor_execute", record)


async def make_alert_row(session: AsyncSession, user, **overrides) -> Alert:
    """An Alert built straight from the model.

    These tests are about what the evaluator does with a Repeat policy;
    going through AlertService would drag in the create rules — the limit,
    the Subscription, the seeding — which have tests of their own. The
    Cooldown defaults to NULL so that a debounce cannot mask a policy.
    """
    alert = Alert(
        user_id=user.id,
        symbol="BTCUSDT",
        condition=AlertCondition.PRICE_ABOVE,
        threshold=Decimal("100"),
        cooldown_seconds=None,
        **overrides,
    )
    session.add(alert)
    await session.flush()
    return alert


async def test_once_fires_exactly_once_and_completes(session, user) -> None:
    """`once` answers "and then what?" — it goes off and leaves service."""
    alert = await make_alert_row(session, user, repeat_policy=AlertRepeatPolicy.ONCE)
    service = AlertEvaluationService(session)

    first = await service.process_tick(make_tick("101"))
    second = await service.process_tick(make_tick("102"))

    assert len(first) == 1
    assert second == []  # not the Cooldown: there is none. The Alert is done.

    await session.refresh(alert)
    assert alert.status is AlertStatus.COMPLETED
    assert alert.finished_at is not None
    assert len(await triggers_of(session, alert.id)) == 1


async def test_a_once_alert_finishes_with_its_trigger(session, user) -> None:
    """The status change and the Trigger describe the same instant.

    Both are stamped from the one `now` of the pass that wrote them, which is
    the visible half of "in the same transaction" — the other half is the
    single commit at the end of process_tick.
    """
    alert = await make_alert_row(session, user, repeat_policy=AlertRepeatPolicy.ONCE)

    await AlertEvaluationService(session).process_tick(make_tick("101"))

    [trigger] = await triggers_of(session, alert.id)
    await session.refresh(alert)
    assert alert.finished_at == trigger.triggered_at


async def test_on_cross_is_silent_while_the_condition_holds(session, user) -> None:
    """A price standing past its Threshold is not a crossing."""
    await make_alert_row(session, user, repeat_policy=AlertRepeatPolicy.ON_CROSS)
    service = AlertEvaluationService(session)

    crossed_in = await service.process_tick(make_tick("101"))
    still_above = [await service.process_tick(make_tick(p)) for p in ("102", "103")]

    assert len(crossed_in) == 1
    assert still_above == [[], []]


async def test_on_cross_fires_again_on_the_tick_that_crosses(session, user) -> None:
    await make_alert_row(session, user, repeat_policy=AlertRepeatPolicy.ON_CROSS)
    service = AlertEvaluationService(session)

    await service.process_tick(make_tick("101"))  # crosses in
    left = await service.process_tick(make_tick("99"))  # leaves the zone
    crossed_again = await service.process_tick(make_tick("101"))

    assert left == []
    assert len(crossed_again) == 1


async def test_on_cross_created_inside_its_zone_stays_silent(session, user) -> None:
    """Seeded as already met, so it speaks only once the price comes back."""
    await make_alert_row(
        session, user, repeat_policy=AlertRepeatPolicy.ON_CROSS, condition_was_met=True
    )

    assert await AlertEvaluationService(session).process_tick(make_tick("101")) == []


async def test_crossing_state_is_written_only_when_it_changes(
    session, user, updates_to_alerts
) -> None:
    """A stable Condition costs no writes at all."""
    await make_alert_row(session, user, repeat_policy=AlertRepeatPolicy.ON_CROSS)
    service = AlertEvaluationService(session)

    await service.process_tick(make_tick("101"))  # the crossing: one claim
    updates_to_alerts.clear()

    for price in ("102", "103", "104"):
        await service.process_tick(make_tick(price))
    assert updates_to_alerts == []

    await service.process_tick(make_tick("99"))  # leaves: exactly one write
    assert len(updates_to_alerts) == 1
