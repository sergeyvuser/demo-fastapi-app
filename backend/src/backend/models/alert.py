import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .mixins import IdUuidPkMixin, TimestampsMixin

if TYPE_CHECKING:
    from .user import User


class AlertCondition(StrEnum):
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"


def condition_holds(
    condition: AlertCondition, threshold: Decimal, price: Decimal
) -> bool:
    """Whether a price satisfies a Condition against its Threshold.

    One function, two callers: the evaluator asks it of a Tick, and the create
    endpoint asks it of the cached price when seeding an `on_cross` Alert. Two
    copies would agree right up until somebody moved a boundary — and both
    comparisons are inclusive on purpose.
    """
    if condition is AlertCondition.PRICE_ABOVE:
        return price >= threshold
    return price <= threshold


class AlertRepeatPolicy(StrEnum):
    """What an Alert does after it has gone off.

    One enum rather than two flags on one axis: a `once` Alert that is also
    "cross only" would be just a `once` Alert — a combination with no meaning
    is a combination somebody has to handle.
    """

    WHILE_TRUE = "while_true"
    ONCE = "once"
    ON_CROSS = "on_cross"


class AlertStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    # A `once` Alert that has gone off. Named for the rule's fate, not for the
    # occasion: CONTEXT.md reserves "Trigger" for the occasion alone, which is
    # why the old `TRIGGERED` had to go. Nothing ever assigned it, so no row
    # carries the old value.
    COMPLETED = "completed"


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
    repeat_policy: Mapped[AlertRepeatPolicy] = mapped_column(
        Enum(
            AlertRepeatPolicy,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        default=AlertRepeatPolicy.WHILE_TRUE,
        server_default=AlertRepeatPolicy.WHILE_TRUE.value,
    )
    # No default, on purpose. NULL means "no debounce", and a column default
    # makes that value unwritable: the ORM cannot tell an explicit None from
    # an omitted value, so it drops the column from the INSERT and the row
    # comes back with the default. The number 3600 lives in AlertBase, where
    # a product policy belongs.
    cooldown_seconds: Mapped[int | None] = mapped_column()
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Whether the Condition held the last time a Tick was evaluated against
    # this Alert. Written only when that truth changes, so an Alert whose
    # Condition is stable costs no writes at all. Durable rather than cached:
    # losing it would not break the system, it would silently change the
    # Alert's behaviour, which looks like correct operation.
    condition_was_met: Mapped[bool] = mapped_column(
        default=False, server_default=false()
    )
    # When the system took the Alert out of service. `updated_at` cannot serve:
    # any edit moves it.
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Since the Alert was created. Not COUNT(*) over triggers: retention deletes
    # rows after 30 days, and a count that shrinks on its own would lie.
    trigger_count: Mapped[int] = mapped_column(default=0, server_default="0")

    __table_args__ = (Index("ix_alerts_symbol_status", "symbol", "status"),)
