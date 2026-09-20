import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, delete, literal, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Trigger


class TriggerRepository:
    """Not a BaseRepository: a Trigger is never updated, so there is no
    update schema to parametrise it with."""

    def __init__(self, session: AsyncSession):
        self.session = session

    def add(self, trigger: Trigger) -> None:
        # No flush: the evaluator commits once for the whole Tick, and a
        # flush per row would be a round trip per Trigger on the hot path.
        self.session.add(trigger)

    async def feed_for_user(
        self,
        user_id: uuid.UUID,
        *,
        alert_id: uuid.UUID | None = None,
        symbol: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        after: tuple[datetime, uuid.UUID] | None = None,
        limit: int = 50,
    ) -> Sequence[Trigger]:
        """The newest Triggers of one user, oldest cut off by the cursor.

        Returns up to limit + 1 rows: the caller drops the extra one and
        learns from its presence that a next page exists, without a count.
        """

        where = [Trigger.user_id == user_id]
        if alert_id is not None:
            where.append(Trigger.alert_id == alert_id)
        if symbol is not None:
            where.append(Trigger.symbol == symbol)
        if since is not None:
            where.append(Trigger.triggered_at >= since)
        if until is not None:
            where.append(Trigger.triggered_at < until)
        if after is not None:
            # Row value comparison: (a, b) < (x, y) means a < x OR (a = x AND
            # b < y) — exactly the ORDER BY below, and the (user_id,
            # triggered_at, id) index answers it without a sort. The types are
            # spelled out so the driver sends timestamptz and uuid rather than
            # guessing from two bare Python values.
            where.append(
                tuple_(Trigger.triggered_at, Trigger.id)
                < tuple_(
                    literal(after[0], Trigger.triggered_at.type),
                    literal(after[1], Trigger.id.type),
                )
            )

        stmt = (
            select(Trigger)
            .where(*where)
            .order_by(Trigger.triggered_at.desc(), Trigger.id.desc())
            .limit(limit + 1)
        )
        return (await self.session.scalars(stmt)).all()

    async def delete_older_than(self, cutoff: datetime) -> int:
        """Bulk delete, returning how many rows went. The caller commits."""
        # DML execute returns a CursorResult at runtime; the signature says Result
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                delete(Trigger).where(Trigger.triggered_at < cutoff)
            ),
        )
        # rowcount is a SQLAlchemy memoized_property; PyCharm reads the raw function
        # noinspection PyTypeChecker
        return result.rowcount
