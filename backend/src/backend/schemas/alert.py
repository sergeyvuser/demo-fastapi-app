import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import IntEnum
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from backend.models.alert import (
    AlertCondition,
    AlertRepeatPolicy,
    AlertStatus,
    current_status,
)

Symbol = Annotated[
    str,
    StringConstraints(to_upper=True, pattern=r"^[a-zA-Z0-9]{5,20}$"),
]
Threshold = Annotated[
    Decimal,
    Field(gt=0, max_digits=20, decimal_places=8),
]


class ExpiryPreset(IntEnum):
    """The only durations an Expiry can be asked for, in seconds.

    A closed set rather than a bounded `int`: a duration outside it is not
    refused, it cannot be written down. "No Expiry" is not a member — it is
    the absence of a value.
    """

    HOURS_24 = 86_400
    DAYS_7 = 7 * 86_400
    DAYS_30 = 30 * 86_400

    def expiry_from(self, now: datetime) -> datetime:
        """The instant this duration ends, counted from `now`."""
        return now + timedelta(seconds=self)


class AlertBase(BaseModel):
    symbol: Symbol
    condition: AlertCondition
    threshold: Threshold
    repeat_policy: AlertRepeatPolicy = AlertRepeatPolicy.WHILE_TRUE
    # None means no debounce. The floor applies to a value that is present:
    # under `once` a Cooldown means nothing, under `on_cross` it is optional.
    cooldown_seconds: int | None = Field(default=3600, ge=60, le=86_400)

    @model_validator(mode="after")
    def _drop_a_cooldown_that_cannot_mean_anything(self) -> Self:
        # A `once` Alert fires one time; there is no second firing to space
        # out. Normalised rather than refused so that cloning an Alert and
        # switching its policy does not make the client clean up after us.
        if self.repeat_policy is AlertRepeatPolicy.ONCE:
            self.cooldown_seconds = None
        return self


class AlertCreate(AlertBase):
    # A duration, not an instant: the server counts it from its own clock.
    expires_in_seconds: ExpiryPreset | None = None


class AlertCreateInternal(AlertBase):
    user_id: uuid.UUID
    condition_was_met: bool = False
    expires_at: datetime | None = None


class AlertRead(AlertBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: AlertStatus = Field(
        description=(
            "The Status in force now. An Alert whose `expires_at` has passed "
            "reads `expired` from that instant, even before the system has "
            "recorded it."
        )
    )
    last_triggered_at: datetime | None
    finished_at: datetime | None
    expires_at: datetime | None
    trigger_count: int
    created_at: datetime

    @model_validator(mode="after")
    def _report_the_status_in_force_now(self) -> Self:
        # The row can lag behind the Expiry by up to a day (see
        # current_status); a reader is told what is true, not what was last
        # written.
        self.status = current_status(self.status, self.expires_at, datetime.now(UTC))
        return self


class AlertUpdateBase(BaseModel):
    threshold: Threshold | None = None
    # Only the two statuses a person chooses. A terminal status is the
    # system's to assign, so asking for one is a malformed request, not a
    # refused one — and the two arrive as 422 and 409 accordingly.
    status: Literal[AlertStatus.ACTIVE, AlertStatus.PAUSED] | None = None
    cooldown_seconds: int | None = Field(default=None, ge=60, le=86_400)


class AlertUpdate(AlertUpdateBase):
    # Omitted leaves the Expiry alone; `null` removes it. The two are told
    # apart by `model_fields_set`, so this field must never gain a validator
    # or a default factory that fills it in.
    expires_in_seconds: ExpiryPreset | None = None

    @field_validator("threshold", "status")
    @classmethod
    def _refuse_null_for_what_cannot_be_removed(cls, value: object) -> object:
        # Field validators run only on values the client sent, never on
        # defaults: an omitted field passes, an explicit `null` is refused.
        # Without this, `null` reaches a NOT NULL column and answers 500.
        if value is None:
            raise ValueError("cannot be null; omit the field to leave it as it is")
        return value


class AlertUpdateInternal(AlertUpdateBase):
    expires_at: datetime | None = None
