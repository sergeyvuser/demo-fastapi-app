from datetime import datetime, timedelta

from loguru import logger
from sqlalchemy import delete, or_

from backend.core.db import AsyncSessionLocal
from backend.models import RefreshToken
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
        result = await session.execute(
            delete(RefreshToken).where(
                or_(
                    RefreshToken.expires_at < cutoff,
                    RefreshToken.revoked_at < cutoff,
                )
            )
        )
        await session.commit()
    logger.bind(purged=result.rowcount).info("refresh token cleanup finished")
    return result.rowcount
