from datetime import UTC, datetime, timedelta

import pytest

from backend.tasks.maintenance import (
    RETENTION_FINISHED_ALERTS,
    RETENTION_TOKENS,
    RETENTION_TRIGGERS,
    retention_cutoff,
)


@pytest.mark.parametrize(
    "window", [RETENTION_TOKENS, RETENTION_TRIGGERS, RETENTION_FINISHED_ALERTS]
)
def test_the_retention_cutoff_is_an_absolute_instant(window: timedelta) -> None:
    cutoff = retention_cutoff(window)

    assert cutoff.tzinfo is not None
    assert cutoff.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - window - cutoff) < timedelta(seconds=5)


def test_finished_alerts_outlive_their_triggers() -> None:
    """Triggers cascade away with their Alert, so a Finished Alert deleted
    sooner than the Trigger window would take live history with it.

    The real rule is `>=`, not `==`: equal by construction today, and this
    is what breaks if somebody turns the alias back into a literal.
    """
    assert RETENTION_FINISHED_ALERTS >= RETENTION_TRIGGERS
    assert timedelta(days=30) == RETENTION_TRIGGERS
