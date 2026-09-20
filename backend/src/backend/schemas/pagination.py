from pydantic import BaseModel


class Page[T](BaseModel):
    items: list[T]
    total: int
    skip: int
    limit: int


class CursorPage[T](BaseModel):
    """Keyset pagination: the cursor names the last row seen, not an offset.

    No `total`: over a feed that grows at the head it would be a second query
    per page, and it would be stale by the time it is rendered.
    """

    items: list[T]
    next_cursor: str | None  # null at the end; no total by design
