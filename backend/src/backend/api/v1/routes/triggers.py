import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import AwareDatetime

from backend.api.deps import CurrentUserDep
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.schemas.alert import Symbol
from backend.schemas.pagination import CursorPage
from backend.schemas.trigger import TriggerRead
from backend.services.trigger import TriggerService

router = APIRouter(prefix=settings.api.v1.triggers, tags=["Triggers"])


@router.get("", response_model=CursorPage[TriggerRead])
async def list_triggers(
    # readable while unverified, like the Alerts list: an account that cannot
    # yet create Alerts still owns the history of the ones it has
    user: CurrentUserDep,
    session: AsyncSessionDep,
    alert_id: uuid.UUID | None = None,
    symbol: Symbol | None = None,
    since: Annotated[AwareDatetime | None, Query(alias="from")] = None,
    until: Annotated[AwareDatetime | None, Query(alias="to")] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """Every Trigger of the current user, newest first.
    \f
    The range is half-open, [from, to): adjacent ranges neither overlap nor
    drop the row that sits exactly on the boundary.

    Paginated by cursor rather than by offset: new Triggers arrive at the head
    of this feed, including over the socket into an open tab, so an offset
    would shift under the reader and repeat rows from the previous page.
    """
    items, next_cursor = await TriggerService(session=session).feed(
        user.id,
        alert_id=alert_id,
        symbol=symbol,
        since=since,
        until=until,
        cursor=cursor,
        limit=limit,
    )
    return CursorPage(items=items, next_cursor=next_cursor)
