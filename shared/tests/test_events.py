import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from shared.events import AlertTriggeredEvent, TickEvent


def test_price_string_becomes_decimal() -> None:
    # this is the real entry path: a JSON payload decoded off the broker,
    # where every number arrives as a string
    tick = TickEvent.model_validate(
        {
            "symbol": "BTCUSDT",
            "price": "64000.12345678",
            "ts": "2026-07-29T12:00:00Z",
        }
    )

    assert tick.price == Decimal("64000.12345678")
    assert tick.ts.tzinfo is not None


def test_json_dump_keeps_the_price_exact() -> None:
    # the evaluator publishes model_dump(mode="json"); a float here would
    # silently round the price somewhere between evaluator and notifier
    tick = TickEvent(
        symbol="BTCUSDT",
        price=Decimal("0.000000012345678"),
        ts=datetime.now(UTC),
    )
    payload = tick.model_dump(mode="json")

    assert isinstance(payload["price"], str)
    assert Decimal(payload["price"]) == tick.price


def test_alert_event_survives_a_broker_roundtrip() -> None:
    # what the evaluator publishes must rebuild exactly on the notifier side
    event = AlertTriggeredEvent(
        alert_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        telegram_chat_id=42,
        symbol="BTCUSDT",
        condition="price_above",
        threshold=Decimal("64000.00000001"),
        price=Decimal("64000.00000002"),
        triggered_at=datetime.now(UTC),
    )

    assert AlertTriggeredEvent.model_validate(event.model_dump(mode="json")) == event


def test_missing_symbol_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TickEvent.model_validate({"price": "1", "ts": "2026-07-29T12:00:00Z"})
