from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import User
from backend.schemas.user import PreferencesUpdate


class UserService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def update_preferences(self, user: User, data: PreferencesUpdate) -> User:
        """Replace the User's preferences — today, the Digest switch alone."""
        user.digest_enabled = data.digest_enabled
        await self.session.commit()
        return user
