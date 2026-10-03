from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.core.db import AsyncSessionLocal
from backend.models import User
from backend.models.alert import Alert, AlertCondition, AlertStatus
from backend.repositories.alert import AlertRepository
from backend.tasks.maintenance import (
    RETENTION_FINISHED_ALERTS,
    expire_alerts,
    purge_finished_alerts,
    retention_cutoff,
)


@pytest.fixture
def tasks_use_the_test_engine(db_engine: AsyncEngine, monkeypatch) -> None:
    """Open the tasks' sessions on the engine the tests own.

    The same database either way. But the module-level engine the tasks
    would otherwise use has a pool nobody disposes; this one is the fixture's,
    created after the migrations and closed at the end of the run. Patched in
    `maintenance`, not in `core.db`: the module holds its own reference.
    """
    monkeypatch.setattr(
        "backend.tasks.maintenance.AsyncSessionLocal",
        partial(AsyncSessionLocal, bind=db_engine),
    )


@pytest.mark.usefixtures("tasks_use_the_test_engine")
async def test_the_sweep_expires_a_paused_alert_the_evaluator_never_sees(
    db_engine: AsyncEngine, committed_alert: Alert
) -> None:
    """The task itself, session and commit included — not just the statement.

    Separate sessions throughout: a sweep that forgot to commit would leave
    the check below reading `paused`.
    """
    expires_at = datetime.now(UTC) - timedelta(hours=5)
    async with AsyncSessionLocal(bind=db_engine) as setup:
        alert = await setup.get(Alert, committed_alert.id)
        assert alert is not None
        alert.status = AlertStatus.PAUSED
        alert.expires_at = expires_at
        await setup.commit()

    assert await expire_alerts() >= 1

    async with AsyncSessionLocal(bind=db_engine) as check:
        alert = await check.get(Alert, committed_alert.id)
        assert alert is not None
        assert alert.status is AlertStatus.EXPIRED
        # five hours late, and still the instant it stopped
        assert alert.finished_at == expires_at


@pytest.mark.usefixtures("tasks_use_the_test_engine")
async def test_the_sweep_leaves_an_alert_whose_expiry_is_still_ahead(
    db_engine: AsyncEngine, committed_alert: Alert
) -> None:
    """An hour ahead is ahead in every zone. Swept against a naive local
    `now`, east of UTC this Alert would be expired hours early."""
    async with AsyncSessionLocal(bind=db_engine) as setup:
        alert = await setup.get(Alert, committed_alert.id)
        assert alert is not None
        alert.status = AlertStatus.PAUSED
        alert.expires_at = datetime.now(UTC) + timedelta(hours=1)
        await setup.commit()

    await expire_alerts()

    async with AsyncSessionLocal(bind=db_engine) as check:
        alert = await check.get(Alert, committed_alert.id)
        assert alert is not None and alert.status is AlertStatus.PAUSED


@pytest.mark.usefixtures("tasks_use_the_test_engine")
async def test_the_purge_deletes_an_alert_finished_past_the_window(
    db_engine: AsyncEngine, committed_alert: Alert
) -> None:
    """The task itself, session and commit included."""
    async with AsyncSessionLocal(bind=db_engine) as setup:
        alert = await setup.get(Alert, committed_alert.id)
        assert alert is not None
        alert.status = AlertStatus.EXPIRED
        alert.finished_at = (
            datetime.now(UTC) - RETENTION_FINISHED_ALERTS - timedelta(days=1)
        )
        await setup.commit()

    assert await purge_finished_alerts() >= 1

    async with AsyncSessionLocal(bind=db_engine) as check:
        assert await check.get(Alert, committed_alert.id) is None
        # the owner stays: retention is about the Alert, not the account
        assert await check.get(User, committed_alert.user_id) is not None


async def test_the_purge_keeps_what_is_not_finished_or_not_old_enough(
    session: AsyncSession, user: User
) -> None:
    long_ago = datetime.now(UTC) - RETENTION_FINISHED_ALERTS - timedelta(days=1)
    recently = datetime.now(UTC) - RETENTION_FINISHED_ALERTS + timedelta(days=1)
    rows = {
        "completed long ago": (AlertStatus.COMPLETED, long_ago),
        "expired recently": (AlertStatus.EXPIRED, recently),
        "active": (AlertStatus.ACTIVE, None),
        "paused": (AlertStatus.PAUSED, None),
    }
    for status, finished_at in rows.values():
        session.add(
            Alert(
                user_id=user.id,
                symbol="BTCUSDT",
                condition=AlertCondition.PRICE_ABOVE,
                threshold=Decimal("100"),
                status=status,
                finished_at=finished_at,
            )
        )
    await session.flush()

    purged = await AlertRepository(session).delete_finished_before(
        retention_cutoff(RETENTION_FINISHED_ALERTS)
    )

    assert purged == 1
    left = set(
        await session.scalars(select(Alert.status).where(Alert.user_id == user.id))
    )
    assert left == {AlertStatus.EXPIRED, AlertStatus.ACTIVE, AlertStatus.PAUSED}
