from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.api.deps import RedisDep
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.core.rate_limit import FixedWindowRateLimiter
from backend.schemas.auth import RefreshRequest, TokenPair
from backend.schemas.user import UserCreate, UserRead
from backend.services.auth import AuthService

router = APIRouter(prefix=settings.api.v1.auth, tags=["Auth"])


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


@router.post("/login", response_model=TokenPair)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSessionDep,
    redis: RedisDep,
    request: Request,
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
    return await AuthService(session).login(
        # OAuth2 form names this field "username"; we pass the email in it
        email=form.username,
        password=form.password,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, session: AsyncSessionDep, request: Request):
    return await AuthService(session).refresh(
        data.refresh_token, user_agent=request.headers.get("user-agent")
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: RefreshRequest, session: AsyncSessionDep):
    await AuthService(session).logout(data.refresh_token)
