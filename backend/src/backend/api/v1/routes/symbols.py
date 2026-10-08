from fastapi import APIRouter, Request

from backend.api.deps import BybitDep, CurrentUserDep, RedisDep
from backend.core.config import settings
from backend.core.exceptions import NotFoundError
from backend.core.rate_limit import FixedWindowRateLimiter
from backend.models import User
from backend.schemas.candle import CandleList
from backend.schemas.symbol import SymbolList, SymbolRead
from backend.services.candles import CandleService
from backend.services.prices import PriceCache

router = APIRouter(
    prefix=settings.api.v1.symbols,
    tags=["Symbols"],
)


@router.get("", response_model=SymbolList)
async def list_symbols(redis: RedisDep) -> SymbolList:
    """Every Symbol the system streams, with its prices and precision.
    \f
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


def _meter_key(user: User, request: Request) -> str:
    """Whom the candles limiter counts.

    The account, because an office behind one NAT is many people on one IP.
    Except the shared demo account: everyone trying the demo is that one User,
    so per-account metering would let one visitor spend the minute for all.
    The prefixes keep an address and an id from ever meaning the same key.
    """
    if settings.demo.enabled and user.email == settings.demo.email:
        client_ip = request.client.host if request.client else "unknown"
        return f"ip:{client_ip}"
    return f"user:{user.id}"


@router.get("/{symbol}/candles", response_model=CandleList)
async def get_candles(
    symbol: str,
    user: CurrentUserDep,
    redis: RedisDep,
    bybit: BybitDep,
    request: Request,
) -> CandleList:
    """The last 24 hours of a Symbol at a 15-minute interval, oldest first.
    \f
    No parameters, deliberately: every parameter would be a cache key, a
    validation branch and a support question, and nothing in the product asks
    for a second window. A range switcher can be added without breaking anyone.

    A session is required because no public screen draws a chart — without
    one this would be a free market-data proxy under our domain name.
    """
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="candles",
        limit=settings.candles.rate_limit,
        window=settings.candles.rate_window_seconds,
    )
    # metered before the Symbol is checked: guessing Symbols costs the same
    await limiter.hit(_meter_key(user, request))
    # Refused before any upstream call: Bybit's own answer for an unknown
    # symbol is a 200 with retCode 10001, and the cache key space stays the
    # Subscription rather than whatever a curious user types.
    if symbol not in settings.subscription:
        raise NotFoundError(detail=f"{symbol} is not a streamed Symbol")
    return CandleList(items=await CandleService(redis, bybit).get(symbol))
