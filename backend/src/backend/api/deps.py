from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from redis.asyncio import Redis

from backend.core.db import AsyncSessionDep
from backend.models import User
from backend.services.auth import AuthService, InvalidAccessTokenError

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

TokenDep = Annotated[str, Depends(oauth2_scheme)]


async def get_current_user(
    token: TokenDep,
    session: AsyncSessionDep,
) -> User:
    try:
        authenticated = await AuthService(session).authenticate(token)
    except InvalidAccessTokenError:
        # FastAPI's own 401, as before: this commit moves the rule, it does
        # not change what a client receives
        raise _credentials_exc from None
    return authenticated.user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def get_current_verified_user(user: CurrentUserDep) -> User:
    if not user.is_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Email not verified")
    return user


CurrentVerifiedUserDep = Annotated[User, Depends(get_current_verified_user)]


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


RedisDep = Annotated[Redis, Depends(get_redis)]


def get_bybit(request: Request) -> httpx.AsyncClient:
    return request.app.state.bybit


BybitDep = Annotated[httpx.AsyncClient, Depends(get_bybit)]
