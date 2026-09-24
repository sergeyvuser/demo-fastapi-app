import pytest

from backend.models.alert import AlertStatus
from backend.services.alert import (
    MAX_ALERTS_PER_USER,
    AlertLimitExceededError,
    AlertNotFoundError,
    AlertService,
    SymbolNotStreamedError,
)


async def test_created_alert_is_readable_back(session, user, alert_factory) -> None:
    alert = await AlertService(session).create(
        user_id=user.id, data=alert_factory.build()
    )

    found = await AlertService(session).get(alert_id=alert.id, user_id=user.id)

    assert found.id == alert.id
    assert found.symbol == "BTCUSDT"


async def test_alert_of_another_user_is_reported_as_missing(
    session, user, other_user, alert_factory
) -> None:
    # not "forbidden": a 403 would confirm that this id exists
    alert = await AlertService(session).create(
        user_id=user.id, data=alert_factory.build()
    )

    with pytest.raises(AlertNotFoundError):
        await AlertService(session).get(alert_id=alert.id, user_id=other_user.id)


async def test_alert_limit_is_enforced(session, user, alert_factory) -> None:
    service = AlertService(session)
    for _ in range(MAX_ALERTS_PER_USER):
        await service.create(user_id=user.id, data=alert_factory.build())

    with pytest.raises(AlertLimitExceededError):
        await service.create(user_id=user.id, data=alert_factory.build())


async def test_deleted_alert_is_gone(session, user, alert_factory) -> None:
    service = AlertService(session)
    alert = await service.create(user_id=user.id, data=alert_factory.build())

    await service.delete(alert_id=alert.id, user_id=user.id)

    with pytest.raises(AlertNotFoundError):
        await service.get(alert_id=alert.id, user_id=user.id)


async def test_symbol_outside_the_subscription_is_refused(
    session, user, alert_factory
) -> None:
    # well-formed and plausible — and not a Symbol this system streams
    with pytest.raises(SymbolNotStreamedError):
        await AlertService(session).create(
            user_id=user.id, data=alert_factory.build(symbol="DOGEUSDT")
        )


async def test_a_paused_alert_still_consumes_a_slot(
    session, user, alert_factory
) -> None:
    """Pausing is a person's choice and keeps the room it took.

    Otherwise 20 active plus any number of paused Alerts would pass, and the
    shared demo account becomes the one-way ratchet reset_demo_account exists
    to prevent.
    """
    service = AlertService(session)
    alerts = [
        await service.create(user_id=user.id, data=alert_factory.build())
        for _ in range(MAX_ALERTS_PER_USER)
    ]

    alerts[0].status = AlertStatus.PAUSED
    await session.flush()

    with pytest.raises(AlertLimitExceededError):
        await service.create(user_id=user.id, data=alert_factory.build())


async def test_a_finished_alert_frees_a_slot(session, user, alert_factory) -> None:
    service = AlertService(session)
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
