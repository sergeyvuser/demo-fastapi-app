from datetime import UTC, datetime, timedelta

import pytest

from backend.models.alert import (
    AlertStatus,
    cooldown_ends_at,
    current_status,
    expiry_has_passed,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
SECOND = timedelta(seconds=1)


@pytest.mark.parametrize(
    ("expires_at", "passed"),
    [
        (None, False),  # no Expiry: watches indefinitely
        (NOW + SECOND, False),
        (NOW, True),  # inclusive: an Expiry equal to now has passed
        (NOW - SECOND, True),
    ],
)
def test_expiry_has_passed(expires_at: datetime | None, passed: bool) -> None:
    assert expiry_has_passed(expires_at, NOW) is passed


@pytest.mark.parametrize("stored", [AlertStatus.ACTIVE, AlertStatus.PAUSED])
def test_an_alert_is_expired_before_the_row_says_so(stored: AlertStatus) -> None:
    assert current_status(stored, NOW - SECOND, NOW) is AlertStatus.EXPIRED


@pytest.mark.parametrize("stored", [AlertStatus.ACTIVE, AlertStatus.PAUSED])
def test_an_alert_before_its_expiry_keeps_its_status(stored: AlertStatus) -> None:
    assert current_status(stored, NOW + SECOND, NOW) is stored


def test_an_alert_without_an_expiry_keeps_its_status() -> None:
    assert current_status(AlertStatus.ACTIVE, None, NOW) is AlertStatus.ACTIVE


def test_a_completed_alert_keeps_its_reason_after_its_expiry() -> None:
    # Finished has one reason, whichever came first, and never gains the other
    assert current_status(AlertStatus.COMPLETED, NOW - SECOND, NOW) is (
        AlertStatus.COMPLETED
    )


@pytest.mark.parametrize(
    ("cooldown_seconds", "last_triggered_at", "ends_at"),
    [
        (None, NOW, None),  # no Cooldown: nothing to space Triggers out
        (3600, None, None),  # never gone off: nothing to count from
        (3600, NOW, NOW + timedelta(hours=1)),
        # elapsed is still an instant here; hiding it is AlertRead's job
        (3600, NOW - timedelta(hours=2), NOW - timedelta(hours=1)),
    ],
)
def test_cooldown_ends_at(
    cooldown_seconds: int | None,
    last_triggered_at: datetime | None,
    ends_at: datetime | None,
) -> None:
    assert cooldown_ends_at(cooldown_seconds, last_triggered_at) == ends_at
