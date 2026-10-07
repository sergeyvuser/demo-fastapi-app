from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class CandleRead(BaseModel):
    """One 15-minute period of a Symbol's price, as the exchange summarised it.

    Fetched to draw a chart and nothing else: never stored, and never what a
    Condition compares against — that is a Tick's job.
    """

    start: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    turnover: Decimal


class CandleList(BaseModel):
    """`items`, like `SymbolList`: an object can grow a field, a bare array cannot."""

    items: list[CandleRead]
