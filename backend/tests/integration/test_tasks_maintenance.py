from datetime import UTC, datetime, timedelta
from functools import partial

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.core.db import AsyncSessionLocal
from backend.models.alert import Alert, AlertStatus
from backend.tasks.maintenance import expire_alerts


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
