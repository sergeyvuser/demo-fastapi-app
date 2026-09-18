"""The wire contract: schemas of every message that crosses the broker.

Both sides of a queue import these same classes, which is why they live in
shared. A field added here is a change between services, not inside one —
see AlertTriggeredEvent.trigger_id for what that costs during a deploy.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class TickEvent(BaseModel):
    """A single price observation from the exchange."""

    symbol: str
    price: Decimal
    ts: datetime  # exchange-side timestamp, UTC
    # The price 24 hours ago, which the exchange reports beside the last price
    # and the UI colours against. Optional on purpose: a Tick published by an
    # older ingestor during a rolling deploy must stay a valid Tick, and the
    # colouring is not worth a poisoned queue.
    reference_price: Decimal | None = None


class AlertTriggeredEvent(BaseModel):
    """Emitted by the evaluator when an alert condition fires.

    Carries everything the notifier needs — including telegram_chat_id —
    so the notifier never has to query the database.
    """

    # The stored Trigger row. Required: an event from an evaluator older than
    # this field is refused and dead-lettered, which was accepted over an
    # expand/contract step. The socket and the browser dedupe on it.
    trigger_id: uuid.UUID  # the stored row; the socket and the browser dedupe on it
    alert_id: uuid.UUID
    user_id: uuid.UUID
    telegram_chat_id: int | None
    symbol: str
    condition: str
    threshold: Decimal
    price: Decimal
    triggered_at: datetime
