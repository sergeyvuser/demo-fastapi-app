from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.user import User
from backend.repositories.base import BaseRepository
from backend.schemas.user import UserCreateInternal, UserUpdate


class UserRepository(BaseRepository[User, UserCreateInternal, UserUpdate]):
    def __init__(self, session: AsyncSession):
        super().__init__(model=User, session=session)

    async def get_by_email(self, email: str) -> User | None:
        stmt = select(self.model).where(self.model.email == email)
        result = await self.session.scalars(stmt)
        return result.one_or_none()

    async def get_by_telegram_chat_id(self, chat_id: int) -> User | None:
        stmt = select(self.model).where(self.model.telegram_chat_id == chat_id)
        result = await self.session.scalars(stmt)
        return result.one_or_none()
