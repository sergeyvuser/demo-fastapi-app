from fastapi import APIRouter, HTTPException, status

from backend.api.deps import CurrentUserDep
from backend.core import AsyncSessionDep
from backend.core.config import settings
from backend.repositories.user import UserRepository
from backend.schemas.user import UserCreate, UserRead

router = APIRouter(
    prefix=settings.api.v1.users,
    tags=["Users"],
)


@router.get(
    "",
    response_model=list[UserRead],
)
async def get_users(session: AsyncSessionDep):
    user_repo = UserRepository(session=session)
    users = await user_repo.get_multi()
    return users


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUserDep):
    return current_user
