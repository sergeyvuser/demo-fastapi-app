import pytest

from backend.services.alert import (
    MAX_ALERTS_PER_USER,
    AlertLimitExceededError,
    AlertNotFoundError,
    AlertService,
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
