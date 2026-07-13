import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
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
    now = datetime.now(timezone.utc)
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


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
