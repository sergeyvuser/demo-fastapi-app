"""How hard the notifier tries before it gives up on a Notification.

The client in shared.telegram makes one request and reads the answer; waiting
and trying again is this process's policy. The API, which answers a person
who is waiting on a form, never retries at all.
"""

import asyncio

from loguru import logger

from shared.telegram import TelegramClient, TelegramUnavailable

_MAX_ATTEMPTS = 3
_RETRY_DELAY_SECONDS = 2.0
# Flood control names its own wait; past this a consumer should rather let
# the message go to the dead-letter queue than sit on it.
_MAX_WAIT_SECONDS = 30.0


async def deliver(client: TelegramClient, chat_id: int, text: str) -> None:
    """Send, retrying transient failures in-process.

    A refusal (no such chat, bot blocked) is permanent and propagates at
    once; network errors, 5xx and 429 are retried, and the last one is
    re-raised when the attempts run out.
    """
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            await client.send_message(chat_id=chat_id, text=text)
            return
        except TelegramUnavailable as exc:
            logger.bind(chat_id=chat_id, attempt=attempt).warning(
                "telegram unavailable ({})", exc
            )
            if attempt == _MAX_ATTEMPTS:
                raise
            wait = exc.retry_after or _RETRY_DELAY_SECONDS * attempt
            await asyncio.sleep(min(wait, _MAX_WAIT_SECONDS))
