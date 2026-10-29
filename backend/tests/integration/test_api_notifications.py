"""What the Account screen is told about the bot and the Digest hour.

Telegram is replaced on app.state by a fake; the client's own getMe reading
and its cache are tested in shared/tests/test_telegram.py.
"""

from collections.abc import Callable, Generator

import pytest
from httpx import AsyncClient

from backend.main import app as fastapi_app
from backend.models import User
from backend.tasks.digest import DIGEST_HOUR_UTC
from shared.telegram import TelegramError, TelegramUnavailable

NOTIFICATIONS = "/api/v1/notifications"


class FakeTelegram:
    def __init__(self) -> None:
        self.answer: str | TelegramError = "alerts_bot"

    async def bot_username(self) -> str:
        if isinstance(self.answer, TelegramError):
            raise self.answer
        return self.answer


@pytest.fixture
def telegram(api_client: AsyncClient) -> Generator[FakeTelegram]:
    fake = FakeTelegram()
    fastapi_app.state.telegram = fake
    yield fake
    del fastapi_app.state.telegram


async def test_names_the_bot_and_the_digest_hour(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    # an unverified User too: reading the instructions comes before verifying
    response = await api_client.get(NOTIFICATIONS, headers=auth_headers(user))

    assert response.status_code == 200
    assert response.json() == {
        "telegram_bot": "alerts_bot",
        "digest_hour_utc": DIGEST_HOUR_UTC,
    }


@pytest.mark.parametrize(
    "failure",
    [TelegramUnavailable("502 Bad Gateway"), TelegramError("unexpected answer 401")],
)
async def test_a_silent_telegram_leaves_the_bot_unnamed(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
    failure: TelegramError,
) -> None:
    telegram.answer = failure

    response = await api_client.get(NOTIFICATIONS, headers=auth_headers(user))

    # the hour is still true, so this is an answer and not a 503
    assert response.status_code == 200
    assert response.json()["telegram_bot"] is None
    assert response.json()["digest_hour_utc"] == DIGEST_HOUR_UTC


async def test_needs_a_session(api_client: AsyncClient, telegram: FakeTelegram) -> None:
    response = await api_client.get(NOTIFICATIONS)

    assert response.status_code == 401
