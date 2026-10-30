"""The Digest: one mail a day telling a User what happened to their Alerts.

Opt-in (`users.digest_enabled`), plain text, English — localised backend mail
is out of scope. Two sections: the Triggers of the window, and the Alerts that
became Finished in it. The second is there because an Expiry emits no Trigger;
without it an Alert could stop watching and nothing would ever say so.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage

import aiosmtplib
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal
from backend.core.mail import send_email
from backend.models import Alert, Trigger, User
from backend.models.alert import AlertCondition, current_status
from backend.repositories.alert import AlertRepository
from backend.repositories.trigger import TriggerRepository
from backend.tasks.broker import broker

# The hour the Digest is sent, in UTC. Read by the schedule below, by the
# footer, and by GET /notifications, so the hour the Account screen names is
# the hour the mail leaves. UTC for the same reason as seed_demo.RESET_HOUR_UTC:
# taskiq matches cron against datetime.now(tz=UTC) unless a task sets
# `cron_offset`.
DIGEST_HOUR_UTC = 8
WINDOW = timedelta(hours=24)
# A while_true Alert on the shortest Cooldown fires 1440 times a day. The mail
# lists the newest and sends the reader to History for the rest.
TRIGGER_LINES_LIMIT = 50

_CONDITION_WORDS = {
    AlertCondition.PRICE_ABOVE: "above",
    AlertCondition.PRICE_BELOW: "below",
}


@dataclass
class Digest:
    user: User
    triggers: list[Trigger] = field(default_factory=list)  # newest first
    finished: list[Alert] = field(default_factory=list)


def digest_window(now: datetime) -> tuple[datetime, datetime]:
    """[since, until): the twenty-four hours one run reports.

    Floored to the minute, which is cron's own resolution: two consecutive
    runs then share their boundary exactly, so an occasion lands in one
    Digest — not in none and not in two — however late in its minute the
    scheduler fires.
    """
    until = now.replace(second=0, microsecond=0)
    return until - WINDOW, until


async def collect_digests(
    session: AsyncSession, since: datetime, until: datetime
) -> list[Digest]:
    """What each recipient is owed for the window.

    A recipient with nothing to report is absent, so a quiet day sends no mail
    at all — decided, not fallen out of the code: a daily "nothing happened"
    teaches the reader to skip the mail, and a young sending domain to land in
    spam. Account says so beside the switch.
    """
    digests: dict[uuid.UUID, Digest] = {}
    for user, trigger in await TriggerRepository(session).for_digest(since, until):
        digests.setdefault(user.id, Digest(user)).triggers.append(trigger)
    for alert in await AlertRepository(session).finished_for_digest(since, until):
        digests.setdefault(alert.user_id, Digest(alert.user)).finished.append(alert)
    return list(digests.values())


def _plain(value: Decimal) -> str:
    # normalize() drops the Numeric(20, 8) padding, but on its own turns 65000
    # into 6.5E+4; the "f" format writes it back out positionally.
    return f"{value.normalize():f}"


def _when(moment: datetime) -> str:
    # No zone is stored on a User, so the mail names the one it speaks.
    return f"{moment.astimezone(UTC):%Y-%m-%d %H:%M} UTC"


def _rule(symbol: str, condition: AlertCondition, threshold: Decimal) -> str:
    return f"{symbol} {_CONDITION_WORDS[condition]} {_plain(threshold)}"


def _counted(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def _finished_at(alert: Alert) -> datetime:
    # Recorded, or not yet: an Expiry the sweep has not reached has no
    # finished_at, and the Expiry itself is the instant the Alert stopped.
    moment = alert.finished_at or alert.expires_at
    assert moment is not None, "finished_between() selects by one of the two"
    return moment


def compose_digest(digest: Digest, until: datetime) -> EmailMessage:
    lines: list[str] = []

    if digest.triggers:
        lines += [f"Triggers in the last 24 hours ({len(digest.triggers)}):", ""]
        lines += [
            f"- {_when(t.triggered_at)}  "
            f"{_rule(t.symbol, t.condition, t.threshold)}, price {_plain(t.price)}"
            for t in digest.triggers[:TRIGGER_LINES_LIMIT]
        ]
        hidden = len(digest.triggers) - TRIGGER_LINES_LIMIT
        if hidden > 0:
            lines.append(f"...and {hidden} more in History.")
        lines.append("")

    if digest.finished:
        lines += [
            f"Alerts that finished ({len(digest.finished)}):",
            "A Finished Alert no longer watches the price. To watch again, clone it.",
            "",
        ]
        for alert in sorted(digest.finished, key=_finished_at, reverse=True):
            # The reason as it stands at the end of the window — the row may
            # still say paused (see finished_between()).
            reason = current_status(alert.status, alert.expires_at, until)
            lines.append(
                f"- {_when(_finished_at(alert))}  "
                f"{_rule(alert.symbol, alert.condition, alert.threshold)}: "
                f"{reason.value}"
            )
        lines.append("")

    # "-- " with the trailing space is the signature separator: mail clients
    # recognise it and fold or dim what follows.
    lines += [
        "-- ",
        "You receive this because you switched the daily Digest on in Account.",
        f"It is sent at {DIGEST_HOUR_UTC:02d}:00 UTC and covers the 24 hours before.",
        f"History: {settings.run.public_url}/history",
    ]

    subject = "Your daily Digest: " + _counted(len(digest.triggers), "Trigger")
    if digest.finished:
        subject += f", {_counted(len(digest.finished), 'Alert')} finished"

    msg = EmailMessage()
    msg["To"] = digest.user.email
    msg["Subject"] = subject
    msg.set_content("\n".join(lines))
    return msg


@broker.task(schedule=[{"cron": f"0 {DIGEST_HOUR_UTC} * * *"}])
async def send_daily_digest() -> int:
    """Mail every User who asked for it what happened to their Alerts.

    No unsubscribe link and no public endpoint behind one: under opt-in
    nobody receives this without having switched it on, and the switch is
    in Account. If the default ever becomes "on", that decision returns.
    """
    since, until = digest_window(datetime.now(UTC))
    async with AsyncSessionLocal() as session:
        digests = await collect_digests(session, since, until)

    sent = 0
    for digest in digests:
        try:
            await send_email(compose_digest(digest, until))
        except aiosmtplib.SMTPException:
            # One refused address must not silence everyone after it; and
            # retrying the task would mail again those already served.
            logger.bind(user_id=str(digest.user.id)).exception("digest not sent")
            continue
        sent += 1
    logger.bind(recipients=sent, failed=len(digests) - sent).info("daily digest sent")
    return sent
