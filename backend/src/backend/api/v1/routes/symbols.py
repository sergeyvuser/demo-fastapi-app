from fastapi import APIRouter

from backend.api.deps import RedisDep
from backend.core.config import settings
from backend.schemas.symbol import SymbolList, SymbolRead
from backend.services.prices import PriceCache

router = APIRouter(
    prefix=settings.api.v1.symbols,
    tags=["Symbols"],
)


@router.get("", response_model=SymbolList)
async def list_symbols(redis: RedisDep) -> SymbolList:
    """Every Symbol the system streams, with its prices and precision.

    Public, like the price endpoint beside it: a signed-out landing page
    shows real prices, and an anonymous visitor gets the list and no socket,
    which is the correct degradation.

    The set comes from configuration and is stable; liveness comes from the
    cache, per item, and is allowed to be absent.
    """
    subscription = settings.subscription
    cached = await PriceCache(redis).get_many(subscription.names)
    return SymbolList(
        items=[
            SymbolRead(
                symbol=symbol.name,
                price=cached[symbol.name].last,
                reference_price=cached[symbol.name].reference,
                precision=symbol.precision,
            )
            for symbol in subscription.symbols
        ]
    )
