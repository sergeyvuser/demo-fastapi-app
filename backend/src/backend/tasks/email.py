import secrets
import uuid
from email.message import EmailMessage

from loguru import logger
from redis.asyncio import Redis

from backend.core.config import settings
from backend.core.mail import send_email
from backend.core.verification import (
    TOKEN_BYTES,
    TOKEN_TTL_SECONDS,
    PendingVerification,
    verification_key,
)
from backend.tasks.broker import broker


@broker.task(retry_on_error=True, max_retries=3)
async def send_verification_email(user_id: str, email: str, username: str) -> None:
    """Generate a one-time token, store it in redis, send the link.

    Token generation lives HERE (not in AuthService): it is part of the
    'send verification' operation — a retry regenerates everything
    consistently.
    """

    token = secrets.token_urlsafe(TOKEN_BYTES)
    record = PendingVerification(user_id=uuid.UUID(user_id))
    redis = Redis.from_url(url=settings.redis.url, decode_responses=True)
    try:
        await redis.set(
            verification_key(token), record.model_dump_json(), ex=TOKEN_TTL_SECONDS
        )
    finally:
        await redis.aclose()

    msg = EmailMessage()
    msg["To"] = email
    msg["Subject"] = "Confirm your email"
    msg.set_content(
        f"Hi {username}!\n\nConfirm your email:\n"
        f"{settings.run.public_url}/verify?token={token}\n\n"
        f"The link is valid for 24 hours."
    )
    await send_email(msg)
    logger.bind(
        user_id=user_id,
        email=email,
    ).info("verification email sent")
