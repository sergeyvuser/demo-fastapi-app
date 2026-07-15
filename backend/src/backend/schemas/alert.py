import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from backend.models.alert import AlertCondition, AlertStatus

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
    cooldown_seconds: int = Field(default=3600, ge=60, le=86_400)


class AlertCreate(AlertBase):
    pass


class AlertCreateInternal(AlertBase):
    user_id: uuid.UUID


class AlertRead(AlertBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: AlertStatus
    last_triggered_at: datetime | None
    created_at: datetime


class AlertUpdate(BaseModel):
    threshold: Threshold | None = None
    status: AlertStatus | None = None
    cooldown_seconds: int | None = Field(default=None, ge=60, le=86_400)
