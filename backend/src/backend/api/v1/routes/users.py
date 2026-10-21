from fastapi import APIRouter, status

from backend.api.deps import (
    CurrentUserDep,
    CurrentVerifiedUserDep,
    RedisDep,
    TelegramDep,
)
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.core.rate_limit import FixedWindowRateLimiter
from backend.schemas.user import LinkedChatUpdate, UserRead
from backend.services.linked_chat import LinkedChatRefusedError, LinkedChatService

router = APIRouter(
    prefix=settings.api.v1.users,
    tags=["Users"],
)


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUserDep):
    return current_user


@router.put("/me/linked-chat", response_model=UserRead)
async def link_chat(
    data: LinkedChatUpdate,
    current_user: CurrentVerifiedUserDep,
    session: AsyncSessionDep,
    redis: RedisDep,
    telegram: TelegramDep,
):
    """Link the Telegram chat Notifications go to, proved by a test message.
    \f
    This proves the chat ACCEPTED a message from our bot — that its owner has
    pressed Start. It does NOT prove the chat belongs to the User saving it:
    anyone can type a stranger's id. The deep-link binding of the next stage
    is where ownership gets proved; this endpoint is removed then.

    Only failed saves are metered (see LinkedChatConfig), so the budget is
    checked first and spent only on a refusal.
    """
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="linked-chat",
        limit=settings.linked_chat.failure_limit,
        window=settings.linked_chat.failure_window_seconds,
    )
    key = str(current_user.id)
    await limiter.check(key)
    try:
        return await LinkedChatService(session, telegram).link(
            current_user, data.chat_id
        )
    except LinkedChatRefusedError:
        await limiter.hit(key)
        raise


@router.delete("/me/linked-chat", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_chat(
    current_user: CurrentUserDep,
    session: AsyncSessionDep,
    telegram: TelegramDep,
):
    """Stop Notifications without touching Alerts. Available at any time.
    \f
    Any signed-in User, verified or not: stopping messages must never be
    harder than starting them.
    """
    await LinkedChatService(session, telegram).unlink(current_user)
