import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from redis.asyncio import Redis

from backend.core import security
from backend.core.db import AsyncSessionDep
from backend.models import User
from backend.repositories.user import UserRepository

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
        payload = security.decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except jwt.InvalidTokenError, KeyError, ValueError:
        raise _credentials_exc from None
    user = await UserRepository(session=session).get_by_id(user_id)
    if user is None or not user.is_active:
        raise _credentials_exc
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


RedisDep = Annotated[Redis, Depends(get_redis)]
