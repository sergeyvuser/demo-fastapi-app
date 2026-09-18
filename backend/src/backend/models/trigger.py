import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from .alert import AlertCondition
from .base import Base
from .mixins import IdUuidPkMixin


class TriggerDelivery(StrEnum):
    """What the evaluator knows about the Notification when it writes the row.

    Not sent/failed: that would need the notifier reporting back, and the
    notifier has no database. An enum rather than a boolean so a second
    channel adds a value instead of renaming a column.
    """

    QUEUED = "queued"
    NO_CHAT = "no_chat"


class Trigger(IdUuidPkMixin, Base):
    """One occasion on which an Alert went off. Immutable once written.

    Symbol, Condition and Threshold are snapshots, not a join: an Alert's
    Threshold is editable, and history must say what the rule was *then*.
    No TimestampsMixin — created_at would restate triggered_at.
    """

    alert_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("alerts.id", ondelete="CASCADE"), index=True
    )
    # denormalised: the feed and the Digest filter by user without a join
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    symbol: Mapped[str] = mapped_column(String(20))
    condition: Mapped[AlertCondition] = mapped_column(
        Enum(
            AlertCondition,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
    )
    threshold: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    price: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delivery: Mapped[TriggerDelivery] = mapped_column(
        Enum(
            TriggerDelivery,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
    )

    __table_args__ = (
        # the feed's keyset order; Postgres scans a btree backwards, so an
        # ascending index serves ORDER BY ... DESC
        Index("ix_triggers_user_id_triggered_at_id", "user_id", "triggered_at", "id"),
    )
