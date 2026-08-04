import secrets
from email.message import EmailMessage

import aiosmtplib
from loguru import logger
from redis.asyncio import Redis

from backend.core.config import settings
from backend.tasks.broker import broker

VERIFY_TOKEN_TTL = 24 * 3600


@broker.task(retry_on_error=True, max_retries=3)
async def send_verification_email(user_id: str, email: str, username: str) -> None:
    """Generate a one-time token, store it in redis, send the link.

    Token generation lives HERE (not in AuthService): it is part of the
    'send verification' operation — a retry regenerates everything
    consistently.
    """

    token = secrets.token_urlsafe(32)
    redis = Redis.from_url(url=settings.redis.url, decode_responses=True)
    try:
        await redis.set(f"verify:{token}", user_id, ex=VERIFY_TOKEN_TTL)
    finally:
        await redis.aclose()

    msg = EmailMessage()
    msg["From"] = settings.smtp.sender
    msg["To"] = email
    msg["Subject"] = "Confirm your email"
    msg.set_content(
        f"Hi {username}!\n\nConfirm your email:\n"
        f"{settings.run.public_url}/api/v1/auth/verify?token={token}\n\n"
        f"The link is valid for 24 hours."
    )
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp.host,
        port=settings.smtp.port,
        # empty strings would make aiosmtplib attempt AUTH against mailpit
        username=settings.smtp.username or None,
        password=settings.smtp.password.get_secret_value() or None,
        # explicit False rather than the library default None: with None
        # aiosmtplib negotiates STARTTLS on its own, and we want the configured
        # behaviour to be the actual behaviour
        start_tls=settings.smtp.security == "starttls",
        use_tls=settings.smtp.security == "tls",
        timeout=settings.smtp.timeout,
    )
    logger.bind(
        user_id=user_id,
        email=email,
    ).info("verification email sent")
