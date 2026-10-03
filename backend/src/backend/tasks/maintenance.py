from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import delete, or_

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal, rows_affected
from backend.models import RefreshToken
from backend.repositories.alert import AlertRepository
from backend.repositories.trigger import TriggerRepository
from backend.seed_demo import reset_demo
from backend.tasks.broker import broker

RETENTION_TOKENS = timedelta(days=30)
# The hot path writes Triggers without bound, so how long they stay is a
# decision, not a default.
RETENTION_TRIGGERS = timedelta(days=30)
# Finished Alerts go this long after `finished_at`, and their Triggers
# cascade away with them. Shorter than RETENTION_TRIGGERS and the cascade
# would eat history still inside its own window — so this is not a second
# number to keep in step, it is the same one.
RETENTION_FINISHED_ALERTS = RETENTION_TRIGGERS


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
        purged = await rows_affected(
            session,
            delete(RefreshToken).where(
                or_(
                    RefreshToken.expires_at < cutoff,
                    RefreshToken.revoked_at < cutoff,
                )
            ),
        )
        await session.commit()
    logger.bind(purged=purged).info("refresh token cleanup finished")
    return purged


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


@broker.task(schedule=[{"cron": "15 3 * * *"}])
async def expire_alerts() -> int:
    """Record EXPIRED on every Alert whose Expiry passed out of the
    evaluator's sight.

    The evaluator records what it loads: Active Alerts on a Symbol that is
    still ticking. This is the net under it — a Paused Alert, the most
    ordinary way to reach an Expiry ("paused and forgotten"); one on a Symbol
    withdrawn from the Subscription; one whose Expiry fell while the system
    was down. Readers do not wait for it — current_status() already says
    `expired` — it only brings the rows in line, and with them the slot
    count and the Digest.

    Between the token cleanup and the Trigger purge, a quarter of an hour
    from each, like the rest of the night.
    """
    async with AsyncSessionLocal() as session:
        expired = await AlertRepository(session).mark_expired(now=datetime.now(UTC))
        await session.commit()
    logger.bind(expired=expired).info("alert expiry sweep finished")
    return expired


@broker.task(schedule=[{"cron": "45 3 * * *"}])
async def purge_finished_alerts() -> int:
    """Delete Alerts Finished longer than RETENTION_FINISHED_ALERTS ago.

    A Finished Alert frees its slot, so nothing else bounds how many pile up.
    After the expiry sweep, so an Alert it has just recorded is judged by the
    `finished_at` it was just given; after the Trigger purge, so the cascade
    finds nothing left to take.
    """
    cutoff = retention_cutoff(RETENTION_FINISHED_ALERTS)
    async with AsyncSessionLocal() as session:
        purged = await AlertRepository(session).delete_finished_before(cutoff)
        await session.commit()
    logger.bind(purged=purged).info("finished alert retention finished")
    return purged
