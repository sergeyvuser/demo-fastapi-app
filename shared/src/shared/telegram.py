"""A thin Telegram Bot API client: one request, one classified answer.

Two processes talk to Telegram: the notifier delivers Notifications, and the
API proves a Linked chat with a test message. Both must read Telegram's answer
the same way, so the reading lives here. What to DO about an answer — wait and
retry, dead-letter, refuse a save — stays with each caller: the notifier can
afford to sleep between attempts, a person waiting on a form cannot.

Needs the `telegram` extra (`shared[telegram]`): httpx is not a dependency of
shared itself, or the ingestor would inherit it for nothing.
"""

from enum import StrEnum

import httpx

_API_URL = "https://api.telegram.org"


class TelegramError(Exception):
    """Telegram did not take the message.

    Raised as-is for an answer we cannot attribute to the chat — 401 or 404
    mean our own bot token is wrong, and neither retrying nor blaming the
    User is the right response to that.
    """


class RefusalReason(StrEnum):
    # No chat with this id has ever started our bot — or it does not exist
    # at all. A bot cannot write first, so the two are indistinguishable.
    NOT_STARTED = "not_started"
    # The chat started the bot once and has blocked it since.
    BLOCKED = "blocked"


class TelegramRefused(TelegramError):
    """Telegram answered definitively: this chat will not take a message.

    Permanent: retrying cannot help. `reason` is ours, not Telegram's — the
    Bot API documents only the numeric `error_code` (and warns that even it
    may change); `description` is a human-readable hint with no contract.
    """

    def __init__(self, reason: RefusalReason, description: str):
        super().__init__(f"{reason}: {description}")
        self.reason = reason
        self.description = description


class TelegramUnavailable(TelegramError):
    """Telegram could not answer now: network, 5xx or flood control.

    Transient. `retry_after` is set only when Telegram itself named the wait.
    """

    def __init__(self, detail: str, retry_after: int | None = None):
        super().__init__(detail)
        self.retry_after = retry_after


class TelegramClient:
    def __init__(
        self,
        bot_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,  # tests only
    ):
        self._client = httpx.AsyncClient(
            base_url=f"{_API_URL}/bot{bot_token}",
            timeout=10.0,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_message(self, chat_id: int, text: str) -> None:
        """One attempt. Returns only if Telegram accepted the message."""
        try:
            response = await self._client.post(
                "/sendMessage",
                json={"chat_id": chat_id, "text": text},
            )
        except httpx.TransportError as exc:
            # The message only, never the request: its URL carries the token.
            raise TelegramUnavailable(f"{type(exc).__name__}: {exc}") from None
        if response.is_success:
            return
        raise _classify(response)


def _classify(response: httpx.Response) -> TelegramError:
    """Turn a non-2xx answer into the error a caller can act on."""
    try:
        body = response.json()
    except ValueError:
        body = {}  # a proxy's HTML error page, not Telegram speaking
    status = response.status_code
    description = str(body.get("description", ""))

    if status == 429 or status >= 500:
        retry_after = body.get("parameters", {}).get("retry_after")
        return TelegramUnavailable(f"{status} {description}", retry_after)
    if status in (400, 403):
        # Matched on the code first, the description only to split 403: a
        # blocked bot is the one refusal the User can undo by themselves.
        # Everything else — "chat not found", "private chat not found",
        # "bot can't initiate conversation", a deleted account — means the
        # same thing to them: this number does not lead to a chat with us.
        if status == 403 and "blocked" in description.lower():
            return TelegramRefused(RefusalReason.BLOCKED, description)
        return TelegramRefused(RefusalReason.NOT_STARTED, description)
    return TelegramError(f"unexpected answer {status} {description}")
