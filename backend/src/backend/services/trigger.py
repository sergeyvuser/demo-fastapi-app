import base64
import binascii
import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.exceptions import BadRequestError
from backend.models import Trigger
from backend.repositories.trigger import TriggerRepository


class InvalidCursorError(BadRequestError):
    default_detail = "Invalid cursor"


def _encode_cursor(triggered_at: datetime, trigger_id: uuid.UUID) -> str:
    """Name the last row of a page: its instant plus its id.

    Opaque, not signed. Forging one only reaches another page of the caller's
    own Triggers, because the user filter is applied regardless of the cursor.
    """
    raw = f"{triggered_at.isoformat()}|{trigger_id}".encode()
    # urlsafe + no padding: a cursor travels in a query string, where "+" and
    # "=" would have to be escaped and are mangled by careless clients
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)  # put back what we stripped
        at, _, trigger_id = base64.urlsafe_b64decode(padded).decode().partition("|")
        decoded = (datetime.fromisoformat(at), uuid.UUID(trigger_id))
    except binascii.Error, UnicodeDecodeError, ValueError:
        raise InvalidCursorError from None
    if decoded[0].tzinfo is None:
        # a naive instant would compare against timestamptz under whatever
        # zone the server happens to run in
        raise InvalidCursorError
    return decoded


class TriggerService:
    def __init__(self, session: AsyncSession):
        self.triggers = TriggerRepository(session)

    async def feed(
        self,
        user_id: uuid.UUID,
        *,
        cursor: str | None = None,
        limit: int = 50,
        **filters,
    ) -> tuple[Sequence[Trigger], str | None]:
        rows = await self.triggers.feed_for_user(
            user_id,
            after=_decode_cursor(cursor) if cursor else None,
            limit=limit,
            **filters,
        )
        if len(rows) <= limit:
            return rows, None  # the extra row is absent: this was the last page
        page = rows[:limit]
        last = page[-1]
        return page, _encode_cursor(last.triggered_at, last.id)
