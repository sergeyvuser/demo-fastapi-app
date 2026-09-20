import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from backend.models.alert import AlertCondition
from backend.models.trigger import TriggerDelivery


class TriggerRead(BaseModel):
    """One occasion, as the feed serves it.

    No user_id: the feed only ever answers with the caller's own Triggers.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    alert_id: uuid.UUID
    symbol: str
    condition: AlertCondition
    threshold: Decimal
    price: Decimal
    triggered_at: datetime
    delivery: TriggerDelivery
