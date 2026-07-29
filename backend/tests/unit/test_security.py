import uuid

import jwt
import pytest

from backend.core import security
from backend.core.config import settings


def test_password_verifies_against_its_own_hash() -> None:
    hashed = security.hash_password("s3cret")

    assert security.verify_password("s3cret", hashed)
    assert not security.verify_password("wrong", hashed)


def test_equal_passwords_hash_differently() -> None:
    # argon2 salts every hash; identical output would mean the salt is missing
    assert security.hash_password("s3cret") != security.hash_password("s3cret")


def test_access_token_roundtrip() -> None:
    user_id = uuid.uuid4()

    payload = security.decode_access_token(security.create_access_token(user_id))

    assert payload["sub"] == str(user_id)
    assert payload["jti"]  # unique id, needed for revocation


def test_expired_token_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "access_token_ttl_minutes", -1)
    token = security.create_access_token(uuid.uuid4())

    with pytest.raises(jwt.ExpiredSignatureError):
        security.decode_access_token(token)


def test_token_signed_with_another_key_is_rejected() -> None:
    forged = jwt.encode(
        {"sub": str(uuid.uuid4())},
        key="attacker-key-long-enough-for-hs256-abcdefgh",
        algorithm=settings.auth.algorithm,
    )

    with pytest.raises(jwt.InvalidSignatureError):
        security.decode_access_token(forged)


def test_refresh_token_hash_is_deterministic_and_unique() -> None:
    token = security.generate_refresh_token()
    other = security.generate_refresh_token()

    assert security.hash_refresh_token(token) == security.hash_refresh_token(token)
    assert security.hash_refresh_token(token) != security.hash_refresh_token(other)
