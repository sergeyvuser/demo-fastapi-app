import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Alert
from backend.models.alert import OCCUPYING_STATUSES, AlertStatus
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
        """How many of the user's slots are occupied.

        ACTIVE and PAUSED. Paused must count: it is a person's choice,
        reversible at any moment, and it takes the same room in the list —
        counting only ACTIVE would admit 20 active plus any number of paused
        Alerts and destroy the protection reset_demo_account exists to give.
        A Finished Alert is exempt, so finishing one frees a slot; maintenance
        deletes it 30 days later (stage 13 ticket 06).
        """
        stmt = (
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.user_id == user_id,
                Alert.status.in_(OCCUPYING_STATUSES),
            )
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
        self,
        alert_id: uuid.UUID,
        *,
        now: datetime,
        cooldown_cutoff: datetime | None,
        crossing: bool = False,
        finish: bool = False,
    ) -> bool:
        """Take the exclusive right to fire this Alert on this Tick.

        The WHERE carries everything that makes this firing legal and the SET
        makes the next one illegal, in one statement — so two concurrent Ticks
        cannot both find it legal. Under READ COMMITTED the loser blocks on the
        locked row and then re-applies this WHERE to the version the winner
        committed, finding nothing to claim.

        `crossing` is the `on_cross` claim: refuse unless the Condition was
        unmet, and record that it is met now. `finish` is the `once` claim:
        this firing is the Alert's last, and the status change lands in the
        same transaction as its Trigger. A cutoff of None is an Alert with no
        Cooldown — no predicate, nothing to wait for.
        """
        where = [Alert.id == alert_id, Alert.status == AlertStatus.ACTIVE]
        values: dict[str, Any] = {
            "last_triggered_at": now,
            # in SQL, so the increment cannot be lost between two readers
            "trigger_count": Alert.trigger_count + 1,
        }

        if cooldown_cutoff is not None:
            where.append(
                or_(
                    Alert.last_triggered_at.is_(None),
                    Alert.last_triggered_at <= cooldown_cutoff,
                )
            )
        if crossing:
            where.append(Alert.condition_was_met.is_(False))
            values["condition_was_met"] = True
        if finish:
            values["status"] = AlertStatus.COMPLETED
            values["finished_at"] = now

        stmt = (
            update(Alert)
            .where(*where)
            .values(**values)
            .returning(Alert.id)
            # The loaded instance is deliberately not synchronised: assigning
            # to it would mark it dirty and flush a second UPDATE.
            .execution_options(synchronize_session=False)
        )
        return await self.session.scalar(stmt) is not None

    async def mark_condition_unmet(self, alert_id: uuid.UUID) -> None:
        """Record that the Condition stopped holding.

        Only ever writes `false`; the other direction belongs to the claim
        above, where it has to be atomic. Nothing races here — two Ticks
        writing the same value write the same value — and the WHERE keeps the
        statement a no-op when the row already says so, so "written only on
        transitions" holds even against a stale read.
        """
        stmt = (
            update(Alert)
            .where(Alert.id == alert_id, Alert.condition_was_met.is_(True))
            .values(condition_was_met=False)
            .execution_options(synchronize_session=False)
        )
        await self.session.execute(stmt)
