from decimal import Decimal

import pytest

from backend.models.alert import AlertCondition, AlertRepeatPolicy, AlertStatus
from backend.services.alert import (
    MAX_ALERTS_PER_USER,
    AlertLimitExceededError,
    AlertNotFoundError,
    AlertService,
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
        data=alert_factory.build(threshold=Decimal("100")),
    )

    # only on_cross has crossing state; the cache is not even consulted
    assert alert.condition_was_met is False
