from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.api.deps import CurrentUserDep, RedisDep
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.core.rate_limit import FixedWindowRateLimiter
from backend.schemas.auth import (
    AccessToken,
    VerificationRequest,
)
from backend.schemas.user import UserCreate, UserRead
from backend.services.auth import AuthService

router = APIRouter(prefix=settings.api.v1.auth, tags=["Auth"])

REFRESH_COOKIE = "refresh_token"
# The auth routes and nothing else. Without a Path the browser would attach
# the most valuable secret in the system to every list request and to the
# socket handshake — and into every log on the way.
REFRESH_COOKIE_PATH = (
    f"{settings.api.prefix}{settings.api.v1.prefix}{settings.api.v1.auth}"
)

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE)]


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        max_age=settings.auth.refresh_token_ttl_days * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )


def _clear_refresh_cookie(response: Response) -> None:
    # a browser identifies a cookie by name, domain AND path: deleting it
    # with any other path deletes nothing and reports no error
    response.delete_cookie(
        key=REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    data: UserCreate,
    session: AsyncSessionDep,
    redis: RedisDep,
    request: Request,
):
    client_ip = request.client.host if request.client else "unknown"
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="register",
        limit=settings.auth.register_rate_limit,
        window=settings.auth.register_rate_window_seconds,
    )
    await limiter.hit(f"{client_ip}")
    return await AuthService(session).register(data)


@router.post("/verify")
async def verify_email(
    data: VerificationRequest,
    session: AsyncSessionDep,
    redis: RedisDep,
):
    await AuthService(session, redis).verify_email(data.verification_token)
    return {"status": "verified"}


@router.post("/resend-verification")
async def resend_verification_email(
    current_user: CurrentUserDep,
    session: AsyncSessionDep,
    redis: RedisDep,
):
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="verification-resend",
        limit=settings.auth.verification_rate_limit,
        window=settings.auth.verification_rate_window_seconds,
    )
    # keyed by address alone, unlike login: the abuse worth stopping here is
    # mailing one person repeatedly, and an IP in the key would hand the same
    # person a fresh allowance from every network they happen to be on
    await limiter.hit(current_user.email)
    await AuthService(session, redis).resend_verification_email(current_user)
    return {"status": "verification_resent"}


@router.post("/login", response_model=AccessToken)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSessionDep,
    redis: RedisDep,
    request: Request,
    response: Response,
):
    client_ip = request.client.host if request.client else "unknown"
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="login",
        limit=settings.auth.login_rate_limit,
        window=settings.auth.login_rate_window_seconds,
    )
    # key by ip AND email: one ip brute-forcing many emails is limited
    # per target; a botnet hitting one email is limited per source
    await limiter.hit(f"{client_ip}:{form.username}")
    tokens = await AuthService(session).login(
        # OAuth2 form names this field "username"; we pass the email in it
        email=form.username,
        password=form.password,
        user_agent=request.headers.get("user-agent"),
    )
    _set_refresh_cookie(response, tokens.refresh_token)
    return AccessToken(access_token=tokens.access_token)


@router.post("/refresh", response_model=AccessToken)
async def refresh(
    session: AsyncSessionDep,
    request: Request,
    response: Response,
    # the default is what makes it optional: `str | None` alone only allows a
    # null, and a missing cookie would be a 422 before the service could say 401
    refresh_token: RefreshCookie = None,
):
    tokens = await AuthService(session).refresh(
        refresh_token, user_agent=request.headers.get("user-agent")
    )
    _set_refresh_cookie(response, tokens.refresh_token)
    return AccessToken(access_token=tokens.access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    session: AsyncSessionDep, response: Response, refresh_token: RefreshCookie = None
):
    await AuthService(session).logout(refresh_token)
    _clear_refresh_cookie(response)
