import uuid
from datetime import UTC, datetime, timedelta

import pytest

from backend.services.trigger import (
    InvalidCursorError,
    _decode_cursor,
    _encode_cursor,
)


def test_a_cursor_survives_a_round_trip() -> None:
    at = datetime.now(UTC) - timedelta(days=1)
    trigger_id = uuid.uuid7()

    assert _decode_cursor(_encode_cursor(at, trigger_id)) == (at, trigger_id)


@pytest.mark.parametrize(
    "cursor",
    [
        "not-base64-at-all!!",
        "YWJj",  # decodes, but has no separator and no instant
        # a naive instant: it would compare against timestamptz under whatever
        # zone the server runs in
        "MjAyNi0wOS0yMFQxMDowMDowMHw2N2UwMWY5Ni0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDA",
    ],
)
def test_a_broken_cursor_is_refused(cursor: str) -> None:
    with pytest.raises(InvalidCursorError):
        _decode_cursor(cursor)
