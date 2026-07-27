import asyncio

import httpx
from loguru import logger

_MAX_ATTEMPTS = 3
_RETRY_DELAY_SECONDS = 2.0


class TelegramSendError(Exception):
    """Raised when a message could not be delivered after retries."""


class TelegramSender:
    def __init__(self, bot_token: str):
        self._client = httpx.AsyncClient(
            base_url=f"https://api.telegram.org/bot{bot_token}",
            timeout=10.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_message(self, chat_id: int, text: str) -> None:
        """Send with in-process retries for transient failures.

        4xx (bad chat id, bot blocked) is permanent — no point retrying;
        network errors and 5xx/429 are transient — retry, then give up.
        """

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = await self._client.post(
                    "/sendMessage",
                    json={"chat_id": chat_id, "text": text},
                )
                if response.status_code < 500 and response.status_code != 429:
                    if response.is_success:
                        return
                    raise TelegramSendError(
                        f"permanent: {response.status_code} {response.text}"
                    )
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                logger.bind(
                    chat_id=chat_id,
                    attempt=attempt,
                ).warning("telegram send failed ({})", exc)
            else:
                logger.bind(
                    chat_id=chat_id,
                    attempt=attempt,
                ).warning("telegram 5xx/429")
            await asyncio.sleep(_RETRY_DELAY_SECONDS * attempt)
        raise TelegramSendError(f"gave up after {_MAX_ATTEMPTS} attempts")
