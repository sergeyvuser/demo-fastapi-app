import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class TickEvent(BaseModel):
    """A single price observation from the exchange."""
    symbol: str
    price: Decimal
    ts: datetime  # exchange-side timestamp, UTC


class AlertTriggeredEvent(BaseModel):
    """Emitted by the evaluator when an alert condition fires.

    Carries everything the notifier needs — including telegram_chat_id —
    so the notifier never has to query the database.
    """
    alert_id: uuid.UUID
    user_id: uuid.UUID
    telegram_chat_id: int | None
    symbol: str
    condition: str
    threshold: Decimal
    price: Decimal
    triggered_at: datetime
