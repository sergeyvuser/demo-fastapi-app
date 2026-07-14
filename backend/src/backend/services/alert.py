import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core import security
from backend.core.config import settings
from backend.core.exceptions import ConflictError, NotFoundError
from backend.models import Alert
from backend.repositories.alert import AlertRepository
from backend.schemas.alert import AlertCreate, AlertCreateInternal, AlertUpdate

MAX_ALERTS_PER_USER = 20


class AlertNotFoundError(NotFoundError):
    def __init__(self):
        super().__init__("Alert not found")


class AlertLimitExceededError(ConflictError):
    def __init__(self):
        super().__init__(f"Alerts limit of {MAX_ALERTS_PER_USER} reached")


class AlertService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.alerts = AlertRepository(session)

    async def create(self, user_id: uuid.UUID, data: AlertCreate) -> Alert:
        if (
            await self.alerts.count_active_for_user(user_id=user_id)
            >= MAX_ALERTS_PER_USER
        ):
            raise AlertLimitExceededError
        alert = await self.alerts.create(
            AlertCreateInternal(**data.model_dump(), user_id=user_id)
        )
        await self.session.commit()
        return alert

    async def get(self, alert_id: uuid.UUID, user_id: uuid.UUID) -> Alert:
        alert = await self.alerts.get_for_user(alert_id=alert_id, user_id=user_id)
        if alert is None:
            raise AlertNotFoundError
        return alert

    async def update(
        self, alert_id: uuid.UUID, user_id: uuid.UUID, data: AlertUpdate
    ) -> Alert:
        alert = await self.get(alert_id=alert_id, user_id=user_id)
        alert = await self.alerts.update(db_obj=alert, schema=data)
        await self.session.commit()
        return alert

    async def delete(self, alert_id: uuid.UUID, user_id: uuid.UUID) -> None:
        alert = await self.get(alert_id=alert_id, user_id=user_id)
        await self.session.delete(alert)
        await self.session.commit()
