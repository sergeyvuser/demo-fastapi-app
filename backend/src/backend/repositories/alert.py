import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Alert
from backend.models.alert import AlertStatus
from backend.repositories.base import BaseRepository
from backend.schemas.alert import AlertCreateInternal, AlertUpdate


class AlertRepository(BaseRepository[Alert, AlertCreateInternal, AlertUpdate]):
    def __init__(self, session: AsyncSession):
        super().__init__(model=Alert, session=session)

    async def get_for_user(
        self, alert_id: uuid.UUID, user_id: uuid.UUID
    ) -> Alert | None:
        stmt = select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
        result = await self.session.scalars(stmt)
        return result.one_or_none()

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        status: AlertStatus | None = None,
        symbol: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[Sequence[Alert], int]:
        where = [Alert.user_id == user_id]
        if status is not None:
            where.append(Alert.status == status)
        if symbol is not None:
            where.append(Alert.symbol == symbol)

        total = await self.session.scalar(
            select(func.count()).select_from(Alert).where(*where)
        )
        stmt = select(Alert).where(*where).order_by(Alert.id).offset(skip).limit(limit)
        result = await self.session.scalars(stmt)
        return result.all(), total or 0

    async def count_active_for_user(self, user_id: uuid.UUID) -> int:
        stmt = (
            select(func.count())
            .select_from(Alert)
            .where(Alert.user_id == user_id, Alert.status != AlertStatus.TRIGGERED)
        )
        return await self.session.scalar(stmt) or 0

    async def get_active_for_symbol(self, symbol: str) -> Sequence[Alert]:
        stmt = select(Alert).where(
            Alert.symbol == symbol,
            Alert.status == AlertStatus.ACTIVE,
        )
        result = await self.session.scalars(stmt)
        return result.all()
