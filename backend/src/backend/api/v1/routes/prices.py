from fastapi import APIRouter

from backend.api.deps import RedisDep
from backend.core.config import settings
from backend.core.exceptions import NotFoundError
from backend.services.prices import PriceCache

router = APIRouter(prefix=settings.api.v1.prices, tags=["Prices"])


@router.get("/prices/{symbol}")
async def get_price(symbol: str, redis: RedisDep) -> dict[str, str]:
    price = await PriceCache(redis).get(symbol.upper())
    if price is None:
        raise NotFoundError(detail=f"No fresh price for {symbol.upper()}")
    return {"symbol": symbol.upper(), "price": str(price)}
