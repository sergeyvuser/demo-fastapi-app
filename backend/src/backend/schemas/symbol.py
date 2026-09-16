from decimal import Decimal

from pydantic import BaseModel


class SymbolRead(BaseModel):
    """One Symbol the system streams, as a client sees it."""

    symbol: str
    # null means "no fresh Tick" — exactly what the cache's 60-second TTL
    # says. Omitting the Symbol instead would hide it from the picker, and a
    # stale number would be a lie with no expiry.
    price: Decimal | None
    # The price 24 hours ago: a fixed reference that holds for hours, so a
    # live price can be coloured the way an exchange colours it instead of by
    # the direction of the last Tick, which flickers four times a second.
    reference_price: Decimal | None
    precision: int


class SymbolList(BaseModel):
    """Deliberately not `Page`: this collection is not paginated and never
    will be. `items` matches `Page`'s own field name so the generated
    TypeScript lines up across endpoints."""

    items: list[SymbolRead]
