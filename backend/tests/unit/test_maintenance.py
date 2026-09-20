from datetime import UTC, datetime, timedelta

import pytest

from backend.tasks.maintenance import (
    RETENTION_TOKENS,
    RETENTION_TRIGGERS,
    retention_cutoff,
)


@pytest.mark.parametrize("window", [RETENTION_TOKENS, RETENTION_TRIGGERS])
def test_the_retention_cutoff_is_an_absolute_instant(window: timedelta) -> None:
    cutoff = retention_cutoff(window)

    assert cutoff.tzinfo is not None
    assert cutoff.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - window - cutoff) < timedelta(seconds=5)


def test_trigger_and_alert_retention_stay_paired() -> None:
    """Triggers cascade away with their Alert, so a Finished Alert deleted
    sooner than the Trigger window would take live history with it.

    A tripwire, not a law: it turns into an equality with the Finished Alert
    window as soon as ticket 06 declares one.
    """
    assert RETENTION_TRIGGERS.days == 30
