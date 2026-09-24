import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.exceptions import BadRequestError, ConflictError, NotFoundError
from backend.models import Alert
from backend.repositories.alert import AlertRepository
from backend.schemas.alert import AlertCreate, AlertCreateInternal, AlertUpdate

MAX_ALERTS_PER_USER = 20


class AlertNotFoundError(NotFoundError):
    default_detail = "Alert not found"


class AlertLimitExceededError(ConflictError):
    def __init__(self):
        super().__init__(
            f"Alerts limit of {MAX_ALERTS_PER_USER} reached. "
            f"Delete one before creating another."
        )


class SymbolNotStreamedError(BadRequestError):
    """A Symbol the schema accepts and the Subscription does not carry.

    Deliberately not a schema validator: that would answer 422, the same code
    as "!!", and the two failures need different words. The shape of a Symbol
    is the request's business; which Symbols exist is the system's.
    """

    def __init__(self, symbol: str):
        super().__init__(f"Symbol {symbol} is not streamed by this system")


class AlertService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.alerts = AlertRepository(session)

    async def create(self, user_id: uuid.UUID, data: AlertCreate) -> Alert:
        # First, and before any query: this one is about the request itself,
        # the limit below is about the account. `Symbol` upper-cases on the way
        # in, and the Subscription is written upper-case, so this compares like
        # with like.
        if data.symbol not in settings.subscription:
            raise SymbolNotStreamedError(data.symbol)
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

    async def list(self, user_id: uuid.UUID, **filters):
        return await self.alerts.list_for_user(user_id=user_id, **filters)

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
