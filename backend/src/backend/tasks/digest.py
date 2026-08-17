from collections.abc import Iterable, Iterator
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from itertools import groupby
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.core.db import AsyncSessionLocal
from backend.core.mail import send_email
from backend.models import Alert
from backend.tasks.broker import broker

if TYPE_CHECKING:
    from backend.models import User


def _group_by_user(alerts: Iterable[Alert]) -> Iterator[tuple[User, list[Alert]]]:
    for _, group in groupby(alerts, key=lambda alert: alert.user_id):
        items = list(group)
        yield items[0].user, items


@broker.task(schedule=[{"cron": "0 8 * * *"}])
async def send_daily_digest() -> int:
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Alert)
            .where(Alert.last_triggered_at >= cutoff)
            .options(selectinload(Alert.user))
            .order_by(Alert.user_id)
        )
        alerts = (await session.scalars(stmt)).all()

    sent = 0
    for user, user_alerts in _group_by_user(alerts):
        lines = [
            (
                f"- {a.symbol}: {a.condition.value} {a.threshold} "
                f"(last at {a.last_triggered_at:%H:%M})"
            )
            for a in user_alerts
        ]
        msg = EmailMessage()
        msg["To"] = user.email
        msg["Subject"] = f"Your alerts digest: {len(user_alerts)} triggered"
        msg.set_content("Triggered in the last 24h:\n\n" + "\n".join(lines))
        await send_email(msg)
        sent += 1
    logger.bind(recipients=sent).info("daily digest sent")
    return sent
