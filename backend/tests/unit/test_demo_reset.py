from datetime import UTC, datetime, timedelta, timezone

import pytest

from backend.seed_demo import RESET_HOUR_UTC, next_reset
from backend.tasks.maintenance import reset_demo_account


def utc(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        # earlier the same day: today's reset
        (utc(10, 23, 1, 30), utc(10, 23, 4)),
        # exactly at the reset: that one is happening, promise the next
        (utc(10, 23, 4), utc(10, 24, 4)),
        # later the same day: tomorrow's
        (utc(10, 23, 22), utc(10, 24, 4)),
        # across a month end
        (utc(10, 31, 5), utc(11, 1, 4)),
    ],
)
def test_the_next_reset_is_the_next_reset_hour(
    now: datetime, expected: datetime
) -> None:
    assert next_reset(now) == expected


def test_a_local_clock_gets_the_same_answer_in_utc() -> None:
    # 02:00 in Moscow is 23:00 UTC the day before: the reset is 5 hours away,
    # not 2 — the hour is UTC whatever zone the caller's clock is in.
    moscow = timezone(timedelta(hours=3))
    reset = next_reset(datetime(2026, 10, 24, 2, 0, tzinfo=moscow))

    assert reset == utc(10, 24, 4)
    assert reset.utcoffset() == timedelta(0)


def test_the_schedule_and_the_promise_read_one_hour() -> None:
    """GET /demo tells visitors when the reset happens; the schedule makes it
    happen. Written twice, the two would part silently."""
    [schedule] = reset_demo_account.labels["schedule"]

    assert schedule["cron"] == f"0 {RESET_HOUR_UTC} * * *"
    # A cron_offset moves the reset out of UTC, and next_reset with it.
    assert "cron_offset" not in schedule
