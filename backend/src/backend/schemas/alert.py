import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from backend.models.alert import AlertCondition, AlertRepeatPolicy, AlertStatus

Symbol = Annotated[
    str,
    StringConstraints(to_upper=True, pattern=r"^[a-zA-Z0-9]{5,20}$"),
]
Threshold = Annotated[
    Decimal,
    Field(gt=0, max_digits=20, decimal_places=8),
]


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
    pass


class AlertCreateInternal(AlertBase):
    user_id: uuid.UUID
    condition_was_met: bool = False


class AlertRead(AlertBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: AlertStatus
    last_triggered_at: datetime | None
    finished_at: datetime | None
    trigger_count: int
    created_at: datetime


class AlertUpdate(BaseModel):
    threshold: Threshold | None = None
    status: AlertStatus | None = None
    cooldown_seconds: int | None = Field(default=None, ge=60, le=86_400)
