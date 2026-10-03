import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from backend.core.config import settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.auth.access_token_ttl_minutes),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(
        payload=payload,
        key=settings.auth.secret_key.get_secret_value(),
        algorithm=settings.auth.algorithm,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Throw jwt.ExpiredSignatureError / jwt.InvalidTokenError"""
    return jwt.decode(
        jwt=token,
        key=settings.auth.secret_key.get_secret_value(),
        algorithms=[settings.auth.algorithm],
    )


def revoked_by_epoch(issued_at: int, tokens_valid_from: datetime | None) -> bool:
    """Whether a logout has revoked a token issued at `issued_at`.

    `iat` is whole seconds, the epoch is not. Truncating the epoch and using
    `<=` makes a token minted in the same second as the logout revoked, never
    spared: it may have been issued a moment after the button was pressed, but
    it may just as well have been issued a moment before, and the rounding has
    to fail closed.
    """
    if tokens_valid_from is None:
        return False
    return issued_at <= int(tokens_valid_from.timestamp())


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
