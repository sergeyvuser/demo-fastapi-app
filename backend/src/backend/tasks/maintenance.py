from datetime import datetime, timedelta
from typing import Any, cast

from loguru import logger
from sqlalchemy import CursorResult, delete, or_

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal
from backend.models import RefreshToken
from backend.seed_demo import reset_demo
from backend.tasks.broker import broker

RETENTION = timedelta(days=30)


@broker.task(schedule=[{"cron": "0 3 * * *"}])
async def cleanup_refresh_tokens() -> int:
    """Purge tokens that expired/were revoked more than RETENTION ago.

    Retention window keeps recent history for debugging (`who logged
    out when`); older rows are dead weight.
    """

    cutoff = datetime.now() - RETENTION
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
