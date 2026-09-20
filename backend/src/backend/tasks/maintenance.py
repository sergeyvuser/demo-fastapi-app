from datetime import UTC, datetime, timedelta
from typing import Any, cast

from loguru import logger
from sqlalchemy import CursorResult, delete, or_

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal
from backend.models import RefreshToken
from backend.repositories.trigger import TriggerRepository
from backend.seed_demo import reset_demo
from backend.tasks.broker import broker

RETENTION_TOKENS = timedelta(days=30)
# Deliberately the same number as the Finished Alert retention (stage 13
# ticket 06): Alerts are deleted 30 days after finishing, and their Triggers
# cascade away with them. If either number changes, change both, or the
# cascade starts eating history that is still inside its own window.
RETENTION_TRIGGERS = timedelta(days=30)


def retention_cutoff(window: timedelta) -> datetime:
    return datetime.now(UTC) - window


@broker.task(schedule=[{"cron": "0 3 * * *"}])
async def cleanup_refresh_tokens() -> int:
    """Purge tokens that expired/were revoked more than RETENTION ago.

    Retention window keeps recent history for debugging (`who logged
    out when`); older rows are dead weight.
    """

    cutoff = retention_cutoff(RETENTION_TOKENS)
    async with AsyncSessionLocal() as session:
        # DML execute returns a CursorResult at runtime; the signature says Result
        result = cast(
            CursorResult[Any],
            await session.execute(
                delete(RefreshToken).where(
                    or_(
                        RefreshToken.expires_at < cutoff,
                        RefreshToken.revoked_at < cutoff,
                    )
                )
            ),
        )
        await session.commit()
    logger.bind(purged=result.rowcount).info("refresh token cleanup finished")
    # rowcount is a SQLAlchemy memoized_property; PyCharm reads the raw function
    # noinspection PyTypeChecker
    return result.rowcount


@broker.task(schedule=[{"cron": "0 4 * * *"}])
async def reset_demo_account() -> int:
    """Return the shared demo account to its seeded state, nightly.

    The Alert limit is per user and the demo account is shared, so without this
    it is a one-way ratchet: visitors add Alerts, nobody removes them, and at
    twenty the demo stops accepting new ones — discovered by whoever tries next.
    A link on a CV has to keep working unattended.

    An hour after the token cleanup rather than alongside it: two jobs at the
    same minute on two vCPUs is a self-inflicted spike for no reason.
    """
    if not settings.demo.enabled:
        return 0
    async with AsyncSessionLocal() as session:
        return await reset_demo(session)


@broker.task(schedule=[{"cron": "30 3 * * *"}])
async def purge_old_triggers() -> int:
    """Delete Triggers older than RETENTION_TRIGGERS.

    This is the only table the hot path writes to without bound: every firing
    of every Alert of every user leaves a row. Retention is therefore a
    decision, not a default.

    Half an hour after the token cleanup and half an hour before the demo
    reset: stacking jobs on the same minute across two vCPUs is a
    self-inflicted spike. The demo account needs nothing here — resetting it
    deletes its Alerts, and the cascade takes their Triggers along.
    """
    cutoff = retention_cutoff(RETENTION_TRIGGERS)
    async with AsyncSessionLocal() as session:
        purged = await TriggerRepository(session).delete_older_than(cutoff)
        await session.commit()
    logger.bind(purged=purged).info("trigger retention finished")
    return purged
