import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdUuidPkMixin, TimestampsMixin

if TYPE_CHECKING:
    from .user import User


class AlertCondition(StrEnum):
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"


class AlertStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    TRIGGERED = "triggered"


class Alert(IdUuidPkMixin, TimestampsMixin, Base):
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    user: Mapped[User] = relationship(lazy="selectin")
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
    status: Mapped[AlertStatus] = mapped_column(
        Enum(
            AlertStatus,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        default=AlertStatus.ACTIVE,
        server_default=AlertStatus.ACTIVE.value,
    )
    cooldown_seconds: Mapped[int] = mapped_column(default=3600, server_default="3600")
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_alerts_symbol_status", "symbol", "status"),)
