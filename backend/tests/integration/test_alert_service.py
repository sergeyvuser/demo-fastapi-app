from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from backend.models.alert import (
    AlertCondition,
    AlertRepeatPolicy,
    AlertStatus,
    current_status,
)
from backend.schemas.alert import AlertUpdate, ExpiryPreset
from backend.services.alert import (
    MAX_ALERTS_PER_USER,
    AlertIsFinishedError,
    AlertLimitExceededError,
    AlertNotFoundError,
    SymbolNotStreamedError,
)
from backend.services.prices import PriceCache


async def test_created_alert_is_readable_back(
    session, user, alert_factory, alert_service
) -> None:
    alert = await alert_service.create(user_id=user.id, data=alert_factory.build())

    found = await alert_service.get(alert_id=alert.id, user_id=user.id)

    assert found.id == alert.id
    assert found.symbol == "BTCUSDT"


async def test_alert_of_another_user_is_reported_as_missing(
    session, user, other_user, alert_factory, alert_service
) -> None:
    # not "forbidden": a 403 would confirm that this id exists
    alert = await alert_service.create(user_id=user.id, data=alert_factory.build())

    with pytest.raises(AlertNotFoundError):
        await alert_service.get(alert_id=alert.id, user_id=other_user.id)


async def test_alert_limit_is_enforced(
    session, user, alert_factory, alert_service
) -> None:
    service = alert_service
    for _ in range(MAX_ALERTS_PER_USER):
        await service.create(user_id=user.id, data=alert_factory.build())

    with pytest.raises(AlertLimitExceededError):
        await service.create(user_id=user.id, data=alert_factory.build())


async def test_deleted_alert_is_gone(
    session, user, alert_factory, alert_service
) -> None:
    service = alert_service
    alert = await service.create(user_id=user.id, data=alert_factory.build())

    await service.delete(alert_id=alert.id, user_id=user.id)

    with pytest.raises(AlertNotFoundError):
        await service.get(alert_id=alert.id, user_id=user.id)


async def test_symbol_outside_the_subscription_is_refused(
    session, user, alert_factory, alert_service
) -> None:
    # well-formed and plausible — and not a Symbol this system streams
    with pytest.raises(SymbolNotStreamedError):
        await alert_service.create(
            user_id=user.id, data=alert_factory.build(symbol="DOGEUSDT")
        )


async def test_a_paused_alert_still_consumes_a_slot(
    session, user, alert_factory, alert_service
) -> None:
    """Pausing is a person's choice and keeps the room it took.

    Otherwise 20 active plus any number of paused Alerts would pass, and the
    shared demo account becomes the one-way ratchet reset_demo_account exists
    to prevent.
    """
    service = alert_service
    alerts = [
        await service.create(user_id=user.id, data=alert_factory.build())
        for _ in range(MAX_ALERTS_PER_USER)
    ]

    alerts[0].status = AlertStatus.PAUSED
    await session.flush()

    with pytest.raises(AlertLimitExceededError):
        await service.create(user_id=user.id, data=alert_factory.build())


async def test_a_finished_alert_frees_a_slot(
    session, user, alert_factory, alert_service
) -> None:
    service = alert_service
    alerts = [
        await service.create(user_id=user.id, data=alert_factory.build())
        for _ in range(MAX_ALERTS_PER_USER)
    ]
    with pytest.raises(AlertLimitExceededError):
        await service.create(user_id=user.id, data=alert_factory.build())

    alerts[0].status = AlertStatus.COMPLETED
    await session.flush()

    # no exception: the slot is back
    await service.create(user_id=user.id, data=alert_factory.build())


async def test_on_cross_created_inside_its_zone_starts_met(
    alert_service, user, alert_factory, clean_redis
) -> None:
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("150"))

    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
            repeat_policy=AlertRepeatPolicy.ON_CROSS,
        ),
    )

    # already past the Threshold at creation: it waits for a real crossing
    assert alert.condition_was_met is True


async def test_on_cross_with_a_cold_cache_starts_unmet(
    alert_service, user, alert_factory, clean_redis
) -> None:
    """A false Trigger beats false silence when we simply do not know."""
    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE,
            threshold=Decimal("100"),
            repeat_policy=AlertRepeatPolicy.ON_CROSS,
        ),
    )

    assert alert.condition_was_met is False


async def test_while_true_never_gets_crossing_state(
    alert_service, user, alert_factory, clean_redis
) -> None:
    await PriceCache(clean_redis).set("BTCUSDT", Decimal("150"))

    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(
            threshold=Decimal("100"),
            # the factory picks a policy at random; this test is about one
            repeat_policy=AlertRepeatPolicy.WHILE_TRUE,
        ),
    )

    # only on_cross has crossing state; the cache is not even consulted
    assert alert.condition_was_met is False


async def test_a_finished_alert_refuses_to_come_back(
    session, alert_service, user, alert_factory
) -> None:
    """ADR 0003: there is no exit from a terminal state."""
    alert = await alert_service.create(user_id=user.id, data=alert_factory.build())
    alert.status = AlertStatus.COMPLETED
    await session.flush()

    with pytest.raises(AlertIsFinishedError):
        await alert_service.update(
            alert_id=alert.id,
            user_id=user.id,
            data=AlertUpdate(status=AlertStatus.ACTIVE),
        )


async def test_a_finished_alert_can_still_be_edited(
    session, alert_service, user, alert_factory
) -> None:
    """The rule is narrow on purpose.

    Nothing returns a Finished Alert to service; everything else is left
    alone, because ticket 26 clones one, and the Triggers it already made
    carry their own Threshold and cannot be rewritten from here.
    """
    alert = await alert_service.create(user_id=user.id, data=alert_factory.build())
    alert.status = AlertStatus.COMPLETED
    await session.flush()

    updated = await alert_service.update(
        alert_id=alert.id, user_id=user.id, data=AlertUpdate(threshold=Decimal("200"))
    )

    assert updated.threshold == Decimal("200")
    assert updated.status is AlertStatus.COMPLETED


async def test_the_server_counts_the_expiry_from_its_own_clock(
    alert_service, user, alert_factory
) -> None:
    before = datetime.now(UTC)

    alert = await alert_service.create(
        user_id=user.id,
        data=alert_factory.build(expires_in_seconds=ExpiryPreset.HOURS_24),
    )

    after = datetime.now(UTC)
    assert alert.expires_at is not None
    assert (
        before + timedelta(hours=24) <= alert.expires_at <= after + timedelta(hours=24)
    )


async def test_an_alert_created_without_an_expiry_has_none(
    alert_service, user, alert_factory
) -> None:
    alert = await alert_service.create(user_id=user.id, data=alert_factory.build())

    assert alert.expires_at is None


async def test_the_status_filter_agrees_with_current_status(
    session, alert_service, user, alert_factory
) -> None:
    """One rule, two spellings: the Python one AlertRead uses and the SQL one
    the list filter uses. Every combination that matters, both ways."""
    now = datetime.now(UTC)
    hour = timedelta(hours=1)
    rows = [
        (AlertStatus.ACTIVE, None),
        (AlertStatus.ACTIVE, now + hour),
        (AlertStatus.ACTIVE, now - hour),
        (AlertStatus.PAUSED, now + hour),
        (AlertStatus.PAUSED, now - hour),
        (AlertStatus.COMPLETED, now - hour),  # keeps its reason
        (AlertStatus.EXPIRED, now - hour),  # already recorded
    ]
    alerts = []
    for stored, expires_at in rows:
        alert = await alert_service.create(user_id=user.id, data=alert_factory.build())
        alert.status = stored
        alert.expires_at = expires_at
        alerts.append(alert)
    await session.flush()

    for status in AlertStatus:
        listed, total = await alert_service.list(user.id, status=status)

        expected = {
            a.id
            for a in alerts
            if current_status(a.status, a.expires_at, now) is status
        }
        assert {a.id for a in listed} == expected, status
        assert total == len(expected), status
