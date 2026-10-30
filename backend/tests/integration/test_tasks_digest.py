import re
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.models import Alert, Trigger, User
from backend.models.alert import AlertCondition, AlertStatus
from backend.models.trigger import TriggerDelivery
from backend.tasks.digest import TRIGGER_LINES_LIMIT, send_daily_digest

MakeUser = Callable[..., Awaitable[User]]


@pytest.fixture(autouse=True)
def digest_reads_the_test_session(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The task opens a session of its own; here it gets the test's.

    The savepoint session, so the rows below need no commit and leave nothing
    behind. Patched in `digest`, which holds its own reference.
    """

    @asynccontextmanager
    async def _test_session() -> AsyncGenerator[AsyncSession]:
        yield session  # left open: the `session` fixture owns it

    monkeypatch.setattr("backend.tasks.digest.AsyncSessionLocal", _test_session)


@pytest.fixture
def letters(monkeypatch: pytest.MonkeyPatch) -> list[EmailMessage]:
    sent: list[EmailMessage] = []

    async def fake_send(message: EmailMessage, **kwargs) -> None:
        sent.append(message)

    monkeypatch.setattr("aiosmtplib.send", fake_send)
    return sent


@pytest.fixture
def make_user(session: AsyncSession) -> MakeUser:
    """A User who asked for the Digest, unless told otherwise."""

    async def _make(**overrides) -> User:
        suffix = uuid.uuid4().hex[:8]
        fields = {
            "username": f"digest-{suffix}",
            "email": f"digest-{suffix}@example.com",
            "hashed_password": "not-a-real-hash",
            "digest_enabled": True,
        } | overrides
        user = User(**fields)
        session.add(user)
        await session.flush()
        return user

    return _make


async def _alert(session: AsyncSession, user: User, **overrides) -> Alert:
    fields = {
        "user_id": user.id,
        "symbol": "BTCUSDT",
        "condition": AlertCondition.PRICE_ABOVE,
        "threshold": Decimal("65000"),
    } | overrides
    alert = Alert(**fields)
    session.add(alert)
    await session.flush()
    return alert


def _trigger(session: AsyncSession, alert: Alert, ago: timedelta) -> None:
    session.add(
        Trigger(
            alert_id=alert.id,
            user_id=alert.user_id,
            symbol=alert.symbol,
            condition=alert.condition,
            threshold=alert.threshold,
            price=Decimal("65012.5"),
            triggered_at=datetime.now(UTC) - ago,
            delivery=TriggerDelivery.NO_CHAT,
        )
    )


def _to(letters: list[EmailMessage], user: User) -> list[EmailMessage]:
    # The task mails every recipient in the database, not only this test's.
    return [letter for letter in letters if letter["To"] == user.email]


async def test_the_digest_counts_triggers_and_lists_each_one(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    user = await make_user()
    # what Numeric(20, 8) hands back from the database; the padding must not
    # reach the mail
    alert = await _alert(session, user, threshold=Decimal("65000.00000000"))
    for hours in (1, 2, 3):
        _trigger(session, alert, timedelta(hours=hours))
    _trigger(session, alert, timedelta(hours=25))  # yesterday's Digest had it
    await session.flush()

    await send_daily_digest()

    [letter] = _to(letters, user)
    assert letter["Subject"] == "Your daily Digest: 3 Triggers"
    body = letter.get_content()
    assert body.count("BTCUSDT above 65000, price 65012.5") == 3
    assert "Alerts that finished" not in body


async def test_the_footer_says_why_and_when_and_links_only_to_history(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    user = await make_user()
    _trigger(session, await _alert(session, user), timedelta(hours=1))
    await session.flush()

    await send_daily_digest()

    [letter] = _to(letters, user)
    body = letter.get_content()
    assert "because you switched the daily Digest on in Account" in body
    assert "08:00 UTC" in body
    assert re.findall(r"https?://\S+", body) == [f"{settings.run.public_url}/history"]
    # opt-in: nothing to unsubscribe from, in the body or in the headers
    assert "unsubscribe" not in body.lower()
    assert "List-Unsubscribe" not in letter
    assert "morning" not in (body + letter["Subject"]).lower()


@pytest.mark.parametrize(
    "fields",
    [{"digest_enabled": False}, {"is_active": False}],
    ids=["switch off", "deactivated with the switch on"],
)
async def test_nobody_is_mailed_who_did_not_ask_or_is_deactivated(
    session: AsyncSession,
    make_user: MakeUser,
    letters: list[EmailMessage],
    fields: dict,
) -> None:
    now = datetime.now(UTC)
    excluded = await make_user(**fields)
    _trigger(session, await _alert(session, excluded), timedelta(hours=1))
    await _alert(
        session,
        excluded,
        status=AlertStatus.COMPLETED,
        finished_at=now - timedelta(hours=1),
    )
    # the control: without it, an empty list would also mean "the task
    # mailed nobody at all"
    asker = await make_user()
    _trigger(session, await _alert(session, asker), timedelta(hours=1))
    await session.flush()

    await send_daily_digest()

    assert _to(letters, excluded) == []
    assert len(_to(letters, asker)) == 1


async def test_finished_alerts_are_reported_with_their_reason(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    now = datetime.now(UTC)
    user = await make_user()
    completed = await _alert(
        session,
        user,
        status=AlertStatus.COMPLETED,
        finished_at=now - timedelta(hours=2),
    )
    _trigger(session, completed, timedelta(hours=2))  # a `once` Alert's one firing
    await _alert(
        session,
        user,
        symbol="ETHUSDT",
        condition=AlertCondition.PRICE_BELOW,
        threshold=Decimal("2000"),
        status=AlertStatus.EXPIRED,
        expires_at=now - timedelta(hours=3),
        finished_at=now - timedelta(hours=3),
    )
    # Finished the day before: that day's Digest reported it
    await _alert(
        session,
        user,
        symbol="XRPUSDT",
        status=AlertStatus.EXPIRED,
        expires_at=now - timedelta(hours=30),
        finished_at=now - timedelta(hours=30),
    )
    await session.flush()

    await send_daily_digest()

    [letter] = _to(letters, user)
    assert letter["Subject"] == "Your daily Digest: 1 Trigger, 2 Alerts finished"
    body = letter.get_content()
    assert "BTCUSDT above 65000: completed" in body
    assert "ETHUSDT below 2000: expired" in body
    assert "XRPUSDT" not in body


async def test_an_expiry_with_no_trigger_still_reaches_its_owner(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    """Paused and forgotten, the most ordinary way to reach an Expiry.

    It passed after the night's sweep, so the row still says `paused` and has
    no `finished_at`. It produced no Trigger: this mail is the only place it
    is ever announced, and tomorrow's would be too late — by then the sweep
    has dated it before that window opens.
    """
    user = await make_user()
    await _alert(
        session,
        user,
        symbol="SOLUSDT",
        status=AlertStatus.PAUSED,
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    await session.flush()

    await send_daily_digest()

    [letter] = _to(letters, user)
    assert letter["Subject"] == "Your daily Digest: 0 Triggers, 1 Alert finished"
    assert "SOLUSDT above 65000: expired" in letter.get_content()


async def test_a_quiet_day_sends_nothing(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    """Decided by the ticket: no "nothing happened" mail."""
    now = datetime.now(UTC)
    quiet = await make_user()
    await _alert(session, quiet)  # watching, never fired
    old = await _alert(
        session,
        quiet,
        status=AlertStatus.COMPLETED,
        finished_at=now - timedelta(hours=30),
    )
    _trigger(session, old, timedelta(hours=30))
    busy = await make_user()  # the control
    _trigger(session, await _alert(session, busy), timedelta(hours=1))
    await session.flush()

    await send_daily_digest()

    assert _to(letters, quiet) == []
    assert len(_to(letters, busy)) == 1


async def test_the_list_stops_at_its_limit_and_points_to_history(
    session: AsyncSession, make_user: MakeUser, letters: list[EmailMessage]
) -> None:
    user = await make_user()
    alert = await _alert(session, user)
    extra = 2
    for minutes in range(TRIGGER_LINES_LIMIT + extra):
        _trigger(session, alert, timedelta(hours=1, minutes=minutes))
    await session.flush()

    await send_daily_digest()

    [letter] = _to(letters, user)
    # the subject counts every Trigger, not the lines that fit
    total = TRIGGER_LINES_LIMIT + extra
    assert letter["Subject"] == f"Your daily Digest: {total} Triggers"
    body = letter.get_content()
    assert body.count(", price ") == TRIGGER_LINES_LIMIT
    assert f"...and {extra} more in History." in body
    # newest first, as History reads: what is cut is the oldest
    oldest = datetime.now(UTC) - timedelta(hours=1, minutes=total - 1)
    assert f"{oldest:%Y-%m-%d %H:%M} UTC" not in body
