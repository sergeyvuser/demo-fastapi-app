from datetime import UTC, datetime, timedelta

from backend.tasks.maintenance import RETENTION, retention_cutoff


def test_the_retention_cutoff_is_an_absolute_instant() -> None:
    cutoff = retention_cutoff()
    assert cutoff.tzinfo is not None
    assert cutoff.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - RETENTION - cutoff) < timedelta(seconds=5)
