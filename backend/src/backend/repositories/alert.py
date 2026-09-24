import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, or_, select, update
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
        stmt = (
            select(Alert)
            .where(
                Alert.symbol == symbol,
                Alert.status == AlertStatus.ACTIVE,
            )
            # Not cosmetic. Two concurrent Ticks lock the Alerts they fire, and
            # two transactions taking the same locks in opposite orders is a
            # deadlock. Without ORDER BY the order is the planner's to choose.
            .order_by(Alert.id)
        )
        result = await self.session.scalars(stmt)
        return result.all()

    async def claim_firing(
        self, aler_id: uuid.UUID, *, cooldown_cutoff: datetime, now: datetime
    ) -> bool:
        """Take the exclusive right to fire this Alert on this Tick.

        The Cooldown is re-checked here, in the statement that acts on it,
        rather than in the Python that read the row a moment ago: Ticks are
        consumed concurrently, and a decision made on a value read without a
        lock is a decision about the past.

        Under READ COMMITTED a second transaction blocks on the locked row,
        then re-applies this WHERE to the version the winner committed — so
        exactly one caller is told `True`, and the loser writes nothing.
        """
        stmt = (
            update(Alert)
            .where(
                Alert.id == aler_id,
                # re-read under the lock: a PATCH may have paused the Alert
                # between the SELECT above and this statement
                Alert.status == AlertStatus.ACTIVE,
                or_(
                    Alert.last_triggered_at.is_(None),
                    Alert.last_triggered_at <= cooldown_cutoff,
                ),
            )
            .values(
                last_triggered_at=now,
                # in SQL, so the increment cannot be lost between two readers
                trigger_count=Alert.trigger_count + 1,
            )
            .returning(Alert.id)
            # The loaded Alert instance is deliberately NOT updated to match:
            # assigning to it would mark it dirty and flush a second UPDATE.
            # Nothing reads those two attributes after this call — tests refresh.
            .execution_options(synchronize_session=False)
        )
        return await self.session.scalar(stmt) is not None
