from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.core import AsyncSessionDep
from backend.core.config import settings
from backend.schemas.auth import RefreshRequest, TokenPair
from backend.schemas.user import UserCreate, UserRead
from backend.services.auth import (
    AuthService,
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)

router = APIRouter(prefix=settings.api.v1.auth, tags=["Auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, session: AsyncSessionDep):
    try:
        return await AuthService(session).register(data)
    except EmailAlreadyRegisteredError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")


@router.post("/login", response_model=TokenPair)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSessionDep,
    request: Request,
):
    try:
        return await AuthService(
            session
        ).login(
            email=form.username,  # в OAuth2-форме поле называется username, кладём туда email
            password=form.password,
            user_agent=request.headers.get("user-agent"),
        )
    except InvalidCredentialsError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, session: AsyncSessionDep, request: Request):
    try:
        return await AuthService(session).refresh(
            data.refresh_token, user_agent=request.headers.get("user-agent")
        )
    except InvalidRefreshTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: RefreshRequest, session: AsyncSessionDep):
    await AuthService(session).logout(data.refresh_token)
