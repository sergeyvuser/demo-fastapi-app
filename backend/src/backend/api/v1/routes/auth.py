from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.schemas.auth import RefreshRequest, TokenPair
from backend.schemas.user import UserCreate, UserRead
from backend.services.auth import AuthService

router = APIRouter(prefix=settings.api.v1.auth, tags=["Auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, session: AsyncSessionDep):
    return await AuthService(session).register(data)


@router.post("/login", response_model=TokenPair)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: AsyncSessionDep,
    request: Request,
):
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
