"""The socket's wire contract: every frame a client sends, every message it gets.

Closed on purpose. Outbound there are exactly five members, discriminated by
`type` — the field a TypeScript client narrows a union on — and a sixth is a
contract change rather than a feature: a "new version available" prompt,
should one ever exist, rides a response header instead. Inbound, three
actions discriminated by `action`.

No prose anywhere: an error is a machine `code` plus structured data, and the
client maps the code to its translation catalogue.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

# -- client -> server ---------------------------------------------------------


class AuthFrame(BaseModel):
    action: Literal["auth"]
    token: str


class WatchFrame(BaseModel):
    action: Literal["watch"]
    symbols: list[str]


class UnwatchFrame(BaseModel):
    action: Literal["unwatch"]
    symbols: list[str]


ClientFrame = AuthFrame | WatchFrame | UnwatchFrame

client_frame: TypeAdapter[ClientFrame] = TypeAdapter(
    Annotated[ClientFrame, Field(discriminator="action")]
)

# -- server -> client ---------------------------------------------------------


class TickMessage(BaseModel):
    type: Literal["tick"] = "tick"
    symbol: str
    price: Decimal
    # null when the Tick came without one; the same shape as GET /symbols
    reference_price: Decimal | None
    ts: datetime


class TriggerMessage(BaseModel):
    type: Literal["trigger"] = "trigger"
    # the stored row: the client dedupes against the history feed by it
    trigger_id: uuid.UUID
    alert_id: uuid.UUID
    symbol: str
    condition: str
    threshold: Decimal
    price: Decimal
    triggered_at: datetime


class WatchingMessage(BaseModel):
    """The set this connection actually watches — authoritative: the client
    diffs what it asked for against it."""

    type: Literal["watching"] = "watching"
    symbols: list[str]


class HeartbeatMessage(BaseModel):
    type: Literal["heartbeat"] = "heartbeat"


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: Literal["unknown_symbols", "invalid_frame"]
    # the rejected names for unknown_symbols, empty otherwise
    symbols: list[str] = []


ServerMessage = (
    TickMessage | TriggerMessage | WatchingMessage | HeartbeatMessage | ErrorMessage
)
