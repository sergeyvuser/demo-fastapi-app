import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

import jwt
from loguru import logger
from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core import security
from backend.core.config import settings
from backend.core.exceptions import ConflictError, GoneError, UnauthorizedError
from backend.core.verification import (
    RECORD_ADAPTER,
    SPENT_RECORD_JSON,
    SpentVerification,
    verification_key,
)
from backend.models.user import User
from backend.repositories.refresh_token import RefreshTokenRepository
from backend.repositories.user import UserRepository
from backend.schemas.user import UserCreate, UserCreateInternal
from backend.tasks.email import send_verification_email
from shared.metrics import auth_successes


class EmailAlreadyRegisteredError(ConflictError):
    default_detail = "Email already registered"


class EmailAlreadyVerifiedError(ConflictError):
    default_detail = "Email already verified"


class InvalidCredentialsError(UnauthorizedError):
    default_detail = "Incorrect email or password"
    metric_reason = "invalid_credentials"


class InvalidRefreshTokenError(UnauthorizedError):
    default_detail = "Invalid refresh token"
    metric_reason = "invalid_refresh"


class InvalidAccessTokenError(UnauthorizedError):
    default_detail = "Could not validate credentials"
    # No metric_reason on purpose: an expired access token is the normal cue
    # to refresh — every open tab produces one every 15 minutes — and counting
    # them would bury the failures the auth panel exists to show.


class VerificationLinkGoneError(GoneError):
    default_detail = "This verification link is no longer valid"
    # the label the Grafana panel already groups by; an expired link is a
    # failure of the authentication funnel, so it keeps being counted
    metric_reason = "invalid_verification"


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    """What a sign-in or a rotation hands out.

    Deliberately not a response schema: the two halves leave by different
    channels — the access token in the body, the refresh token in an httpOnly
    cookie — and deciding that is the HTTP layer's job, not this service's.
    """

    access_token: str
    refresh_token: str


@dataclass(frozen=True, slots=True)
class Authenticated:
    """Who an access token speaks for, and until when.

    The expiry is for the socket: a request is over long before its token
    expires, a socket is not, and has to be closed once it does.
    """

    user: User
    expires_at: datetime


# Pre-calculated hash for response time alignment (see login)
_DUMMY_HASH = security.hash_password("dummy-password-for-timing")


class AuthService:
    def __init__(self, session: AsyncSession, redis: Redis | None = None):
        self.session = session
        self.users = UserRepository(session)
        self.tokens = RefreshTokenRepository(session)
        self.redis = redis

    async def authenticate(self, access_token: str) -> Authenticated:
        """The one rule an access token is accepted by, over HTTP and the socket.

        A valid signature is not enough: the User must still exist and be
        active, and a logout must not have revoked the token by its epoch.
        """
        try:
            payload = security.decode_access_token(access_token)
            user_id = uuid.UUID(payload["sub"])
            issued_at = payload["iat"]
            expires_at = datetime.fromtimestamp(payload["exp"], UTC)
        except jwt.InvalidTokenError, KeyError, ValueError:
            raise InvalidAccessTokenError from None
        user = await self.users.get_by_id(user_id)
        # the row is loaded anyway for the active check, so the epoch costs nothing
        if (
            user is None
            or not user.is_active
            or security.revoked_by_epoch(issued_at, user.tokens_valid_from)
        ):
            raise InvalidAccessTokenError
        return Authenticated(user=user, expires_at=expires_at)

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
        await send_verification_email.kiq(
            user_id=str(user.id), email=user.email, username=user.username
        )
        return user

    async def verify_email(self, token: str) -> None:
        assert self.redis is not None
        key = verification_key(token=token)
        raw = cast("str | None", await self.redis.get(key))
        if raw is None:
            raise VerificationLinkGoneError
        try:
            record = RECORD_ADAPTER.validate_json(raw)
        except ValidationError:
            # Written by a previous release: in-flight tokens outlive a deploy
            # by up to the TTL. A 410 lets the User ask for another letter;
            # a 500 would just page us for a shape that heals itself.
            logger.bind(key=key).warning("unreadable verification record")
            raise VerificationLinkGoneError from None
        if isinstance(record, SpentVerification):
            raise EmailAlreadyVerifiedError
        user = await self.users.get_by_id(record.user_id)
        if user is None:
            # The record outlived the User it names: there is nobody to verify,
            # and the token is left untouched to expire on its own.
            raise VerificationLinkGoneError
        if user.is_verified:
            # Reachable through resend: a second letter adds a second live
            # token, so an older link can still be pending after the newer one
            # was used. Same answer as a spent link, because the next action is
            # the same — sign in.
            raise EmailAlreadyVerifiedError
        user.is_verified = True
        await self.session.commit()
        # Spend the token only once the verification is durable. The reverse
        # order burns a valid link whenever the commit fails, and a burnt link
        # now costs a sign-in before it can be re-sent. A crash *here* instead
        # leaves a pending record on a verified User — which the branch above
        # already answers correctly.
        await self.redis.set(key, SPENT_RECORD_JSON, xx=True, keepttl=True)

    async def resend_verification_email(self, user: User) -> None:
        if user.is_verified:
            raise EmailAlreadyVerifiedError
        await send_verification_email.kiq(
            user_id=str(user.id), email=user.email, username=user.username
        )

    async def login(
        self, email: str, password: str, user_agent: str | None = None
    ) -> IssuedTokens:
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
        tokens = await self._issue_tokens(user_id=user.id, user_agent=user_agent)
        await self.session.commit()
        auth_successes.inc()
        return tokens

    async def refresh(
        self, refresh_token: str | None, user_agent: str | None = None
    ) -> IssuedTokens:
        if refresh_token is None:
            # no cookie at all: the browser was never signed in here, or the
            # cookie expired on its own — the same answer as a forged one
            raise InvalidRefreshTokenError
        token = await self.tokens.get_by_hash(
            token_hash=security.hash_refresh_token(refresh_token)
        )
        if token is None:
            raise InvalidRefreshTokenError
        now = datetime.now(UTC)
        if token.revoked_at is not None:
            # A revoked token was presented again => it leaked;
            # revoke the entire session family
            await self.tokens.revoke_all_for_user(token.user_id)
            await self.session.commit()
            raise InvalidRefreshTokenError
        if token.expires_at <= now:
            raise InvalidRefreshTokenError
        await self.tokens.revoke(token)  # rotation: the old one goes out
        tokens = await self._issue_tokens(user_id=token.user_id, user_agent=user_agent)
        await self.session.commit()
        return tokens

    async def logout(self, user: User, refresh_token: str | None) -> None:
        # Every access token this User holds dies here, on every device. The
        # other devices' refresh cookies survive, so they re-refresh and carry
        # on; only this one is actually signed out.
        user.tokens_valid_from = datetime.now(UTC)
        if refresh_token is not None:
            token = await self.tokens.get_by_hash(
                token_hash=security.hash_refresh_token(refresh_token)
            )
            # only the caller's own: a cookie naming another User is not this
            # request's to revoke
            if (
                token is not None
                and token.user_id == user.id
                and token.revoked_at is None
            ):
                await self.tokens.revoke(token)
        await self.session.commit()

    async def _issue_tokens(
        self, user_id: uuid.UUID, user_agent: str | None
    ) -> IssuedTokens:
        raw_refresh = security.generate_refresh_token()
        await self.tokens.add(
            user_id=user_id,
            token_hash=security.hash_refresh_token(raw_refresh),
            expires_at=datetime.now(UTC)
            + timedelta(days=settings.auth.refresh_token_ttl_days),
            user_agent=user_agent,
        )
        return IssuedTokens(
            access_token=security.create_access_token(user_id=user_id),
            refresh_token=raw_refresh,
        )
