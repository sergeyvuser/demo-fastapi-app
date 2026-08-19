from fastapi import APIRouter

from backend.api.deps import CurrentUserDep
from backend.core.config import settings
from backend.schemas.user import UserRead

router = APIRouter(
    prefix=settings.api.v1.users,
    tags=["Users"],
)


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUserDep):
    return current_user
