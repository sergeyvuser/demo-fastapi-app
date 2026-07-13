import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core import security
from backend.core.config import settings
from backend.models.user import User
from backend.repositories.refresh_token import RefreshTokenRepository
from backend.repositories.user import UserRepository
from backend.schemas.auth import TokenPair
from backend.schemas.user import UserCreate, UserCreateInternal


class AuthError(Exception):
    """Base class for auth exceptions."""


class EmailAlreadyRegisteredError(AuthError):
    pass


class InvalidCredentialsError(AuthError):
    pass


class InvalidRefreshTokenError(AuthError):
    pass


# Pre-calculated hash for response time alignment (see login)
_DUMMY_HASH = security.hash_password("dummy-password-for-timing")


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.tokens = RefreshTokenRepository(session)

    async def register(self, data: UserCreate) -> User:
        if await self.users.get_by_email(data.email):
            raise EmailAlreadyRegisteredError
        user = await self.users.create(
            UserCreateInternal(
                username=data.username,
                email=data.email,
                hashed_password=security.hash_password(data.password),
            )
        )
        await self.session.commit()
        return user

    async def login(
        self, email: str, password: str, user_agent: str | None = None
    ) -> TokenPair:
        user = await self.users.get_by_email(email)
        if user is None:
            # Spend as much time verifying fakes as we do verifying real ones.
            security.verify_password(password=password, hashed=_DUMMY_HASH)
            raise InvalidCredentialsError
        if (
            not security.verify_password(password=password, hashed=user.hashed_password)
            or not user.is_active
        ):
            raise InvalidCredentialsError
        pair = await self._issue_pair(user.id, user_agent)
        await self.session.commit()
        return pair

    async def refresh(
        self, refresh_token: str, user_agent: str | None = None
    ) -> TokenPair:
        token = await self.tokens.get_by_hash(
            token_hash=security.hash_refresh_token(refresh_token)
        )
        if token is None:
            raise InvalidRefreshTokenError
        now = datetime.now(timezone.utc)
        if token.revoked_at is not None:
            # A revoked token was presented again => leak; revoke the entire session family
            await self.tokens.revoke_all_for_user(token.user_id)
            await self.session.commit()
            raise InvalidRefreshTokenError
        if token.expires_at <= now:
            raise InvalidRefreshTokenError
        await self.tokens.revoke(token)  # rotation: the old one goes out
        pair = await self._issue_pair(token.user_id, user_agent)
        await self.session.commit()
        return pair

    async def logout(self, refresh_token: str) -> None:
        token = await self.tokens.get_by_hash(
            token_hash=security.hash_refresh_token(refresh_token)
        )
        if token is not None and token.revoked_at is None:
            await self.tokens.revoke(token)
            await self.session.commit()

    async def _issue_pair(self, user_id: uuid.UUID, user_agen: str | None) -> TokenPair:
        raw_refresh = security.generate_refresh_token()
        await self.tokens.add(
            user_id=user_id,
            token_hash=security.hash_refresh_token(raw_refresh),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.auth.refresh_token_ttl_days),
            user_agent=user_agen,
        )
        return TokenPair(
            access_token=security.create_access_token(user_id=user_id),
            refresh_token=raw_refresh,
        )
