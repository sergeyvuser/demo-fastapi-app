"""The Linked chat: where a User's Notifications are delivered.

A value is stored only after Telegram accepted a test message to it. That is
a real check, because a bot cannot write first: a chat that never pressed
Start on our bot is refused, and so is one that blocked it. What it does NOT
prove is that the chat belongs to the User who typed the number — anyone who
knows a stranger's id, and whose stranger has started the bot, can link it.
The test message names the account so that stranger at least finds out. The
real binding — a single-use deep link the chat itself sends back — is the
next stage, and it replaces this whole module (the UNIQUE column stays).
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    ServiceUnavailableError,
)
from backend.models import User
from backend.repositories.user import UserRepository
from shared.telegram import (
    RefusalReason,
    TelegramClient,
    TelegramRefused,
    TelegramUnavailable,
)

_PROBLEM = "urn:alerts:linked-chat"
# Telegram's own wait when it names one; otherwise a pause a person can bear.
_DEFAULT_RETRY_AFTER_SECONDS = 30


class LinkedChatRefusedError(BadRequestError):
    """A save that failed because of the number itself.

    The route counts exactly these against the failed-save budget: they are
    what a typo storm and a probe for existing chat ids both look like.
    """


class ChatNotStartedError(LinkedChatRefusedError):
    problem_type = f"{_PROBLEM}:not-started"
    default_detail = (
        "Telegram knows no chat with this id that has started the bot. "
        "Press Start on the bot first, then check the number."
    )


class BotBlockedError(LinkedChatRefusedError):
    problem_type = f"{_PROBLEM}:blocked"
    default_detail = "This chat has blocked the bot. Unblock it, then save again."


class ChatTakenError(ConflictError, LinkedChatRefusedError):
    problem_type = f"{_PROBLEM}:taken"
    default_detail = "This chat is already linked to another account."


class DemoLinkedChatError(ForbiddenError):
    default_detail = (
        "The demo account is shared by everyone trying it, so a chat linked "
        "here would receive strangers' Notifications. Register your own account."
    )


_REFUSALS: dict[RefusalReason, type[LinkedChatRefusedError]] = {
    RefusalReason.NOT_STARTED: ChatNotStartedError,
    RefusalReason.BLOCKED: BotBlockedError,
}


def _test_message(user: User) -> str:
    return (
        f"Crypto Alerts: this chat will now receive Notifications for the "
        f"account “{user.username}”.\n"
        f"Not you? Block this bot and nothing more will arrive."
    )


class LinkedChatService:
    def __init__(self, session: AsyncSession, telegram: TelegramClient):
        self.session = session
        self.telegram = telegram
        self.users = UserRepository(session)

    async def link(self, user: User, chat_id: int) -> User:
        _refuse_demo(user)
        # Before the message, not after: a number already linked to someone
        # else must not cost its owner a message from a stranger's account.
        owner = await self.users.get_by_telegram_chat_id(chat_id)
        if owner is not None and owner.id != user.id:
            raise ChatTakenError()

        try:
            await self.telegram.send_message(chat_id=chat_id, text=_test_message(user))
        except TelegramRefused as exc:
            raise _REFUSALS[exc.reason]() from exc
        except TelegramUnavailable as exc:
            # Not the number's fault, so not a refusal: costs no budget.
            raise ServiceUnavailableError(
                "Telegram did not answer. Try again in a moment.",
                retry_after=exc.retry_after or _DEFAULT_RETRY_AFTER_SECONDS,
            ) from exc
        # Any other TelegramError means our own bot token is wrong: it
        # propagates as a 500, which is what it is.

        user.telegram_chat_id = chat_id
        try:
            await self.session.commit()
        except IntegrityError:
            # Two accounts saved the same number at once and both passed the
            # check above; the UNIQUE constraint decided which one won.
            await self.session.rollback()
            raise ChatTakenError() from None
        return user

    async def unlink(self, user: User) -> None:
        """Stop Notifications. Alerts stay as they are and keep Triggering."""
        _refuse_demo(user)
        user.telegram_chat_id = None
        await self.session.commit()


def _refuse_demo(user: User) -> None:
    # Enforced here, not only hidden in the UI: on a shared account the
    # first person to link would receive everyone's Notifications until the
    # nightly reset — an irreversible privacy harm, unlike shared settings.
    if settings.demo.is_demo(user.email):
        raise DemoLinkedChatError()
