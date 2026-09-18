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
