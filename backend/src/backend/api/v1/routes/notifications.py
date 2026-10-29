from fastapi import APIRouter
from loguru import logger

from backend.api.deps import CurrentUserDep, TelegramDep
from backend.core.config import settings
from backend.schemas.notifications import NotificationsRead
from backend.tasks.digest import DIGEST_HOUR_UTC
from shared.telegram import TelegramError

router = APIRouter(
    prefix=settings.api.v1.notifications,
    tags=["Notifications"],
)


@router.get("", response_model=NotificationsRead)
async def get_notifications(
    _: CurrentUserDep, telegram: TelegramDep
) -> NotificationsRead:
    """The bot a Linked chat must start, and the hour the Digest is sent.
    \f
    Signed-in, not public: the Account screen is its only reader, and a
    public path would let anyone make us call Telegram while it is down —
    the name is cached only once Telegram has answered.

    A Telegram failure is not this endpoint's failure: the Digest hour is
    still true, so the answer carries a null bot rather than a 503.
    """
    try:
        bot: str | None = await telegram.bot_username()
    except TelegramError as exc:
        logger.bind(error=str(exc)).warning("telegram did not name the bot")
        bot = None
    return NotificationsRead(telegram_bot=bot, digest_hour_utc=DIGEST_HOUR_UTC)
