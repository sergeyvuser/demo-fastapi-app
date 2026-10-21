"""The Linked chat endpoint: saved only after Telegram took a test message.

Telegram itself is replaced on app.state by a fake that either accepts or
raises what the real client would; the client's own reading of Telegram's
answers is tested in shared/tests/test_telegram.py.
"""

from collections.abc import Callable, Generator

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.main import app as fastapi_app
from backend.models import User
from backend.services.alert import AlertService
from shared.telegram import (
    RefusalReason,
    TelegramError,
    TelegramRefused,
    TelegramUnavailable,
)

LINKED_CHAT = "/api/v1/users/me/linked-chat"
CHAT_ID = 777000111


class FakeTelegram:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []
        self.answer: TelegramError | None = None  # None = accepted

    async def send_message(self, chat_id: int, text: str) -> None:
        if self.answer is not None:
            raise self.answer
        self.sent.append((chat_id, text))


@pytest.fixture
def telegram(api_client: AsyncClient) -> Generator[FakeTelegram]:
    fake = FakeTelegram()
    fastapi_app.state.telegram = fake
    yield fake
    del fastapi_app.state.telegram


@pytest.fixture
def headers(
    verified_user: User, auth_headers: Callable[[User], dict[str, str]]
) -> dict[str, str]:
    return auth_headers(verified_user)


def not_started() -> TelegramRefused:
    return TelegramRefused(RefusalReason.NOT_STARTED, "Bad Request: chat not found")


async def test_an_accepted_message_saves_the_chat(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    verified_user: User,
) -> None:
    response = await api_client.put(
        LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
    )

    assert response.status_code == 200
    assert response.json()["telegram_chat_id"] == CHAT_ID
    assert [chat for chat, _ in telegram.sent] == [CHAT_ID]
    # the message names the account, so a stranger whose id was typed finds out
    assert verified_user.username in telegram.sent[0][1]


@pytest.mark.parametrize(
    ("reason", "problem_type"),
    [
        (RefusalReason.NOT_STARTED, "urn:alerts:linked-chat:not-started"),
        (RefusalReason.BLOCKED, "urn:alerts:linked-chat:blocked"),
    ],
)
async def test_a_refusal_is_not_saved_and_says_which_one(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    verified_user: User,
    reason: RefusalReason,
    problem_type: str,
) -> None:
    telegram.answer = TelegramRefused(reason, "whatever Telegram said")
    before = verified_user.telegram_chat_id

    response = await api_client.put(
        LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["type"] == problem_type
    me = await api_client.get("/api/v1/users/me", headers=headers)
    assert me.json()["telegram_chat_id"] == before


async def test_a_chat_linked_elsewhere_is_refused_without_a_message(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    user: User,
) -> None:
    assert user.telegram_chat_id is not None

    response = await api_client.put(
        LINKED_CHAT, json={"chat_id": user.telegram_chat_id}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["type"] == "urn:alerts:linked-chat:taken"
    assert telegram.sent == []  # its owner is not messaged by a stranger


@pytest.mark.parametrize("chat_id", [0, -1001234567890, 2**53])
async def test_only_a_private_chat_id_the_browser_can_hold_is_accepted(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    chat_id: int,
) -> None:
    response = await api_client.put(
        LINKED_CHAT, json={"chat_id": chat_id}, headers=headers
    )

    assert response.status_code == 422
    assert telegram.sent == []


async def test_an_unverified_account_cannot_link(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    response = await api_client.put(
        LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=auth_headers(user)
    )

    assert response.status_code == 403
    assert telegram.sent == []


async def test_the_demo_account_is_refused_at_the_endpoint(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    session: AsyncSession,
    auth_headers: Callable[[User], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.demo, "enabled", True)
    demo = User(
        username="demo-in-test",
        email=settings.demo.email,
        hashed_password="not-a-real-hash",
        is_verified=True,
    )
    session.add(demo)
    await session.flush()
    headers = auth_headers(demo)

    put = await api_client.put(LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers)
    delete = await api_client.delete(LINKED_CHAT, headers=headers)

    assert put.status_code == 403
    assert delete.status_code == 403
    assert telegram.sent == []


async def test_clearing_stops_notifications_and_keeps_alerts(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    verified_user: User,
    alert_service: AlertService,
    alert_factory,
) -> None:
    await alert_service.create(verified_user.id, alert_factory.build())

    response = await api_client.delete(LINKED_CHAT, headers=headers)

    assert response.status_code == 204
    me = await api_client.get("/api/v1/users/me", headers=headers)
    assert me.json()["telegram_chat_id"] is None
    alerts = await api_client.get("/api/v1/alerts", headers=headers)
    assert alerts.json()["total"] == 1
    assert telegram.sent == []


async def test_only_failed_saves_spend_the_budget(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.linked_chat, "failure_limit", 1)

    # more successes than the whole budget: none of them may count
    for _ in range(3):
        saved = await api_client.put(
            LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
        )
        assert saved.status_code == 200

    telegram.answer = not_started()
    first_failure = await api_client.put(
        LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
    )
    after_budget = await api_client.put(
        LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
    )

    assert first_failure.status_code == 400
    assert after_budget.status_code == 429
    assert "Retry-After" in after_budget.headers


async def test_telegram_being_down_is_not_the_users_failure(
    api_client: AsyncClient,
    telegram: FakeTelegram,
    headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.linked_chat, "failure_limit", 1)
    telegram.answer = TelegramUnavailable("503 Service Unavailable", retry_after=7)

    for _ in range(3):
        response = await api_client.put(
            LINKED_CHAT, json={"chat_id": CHAT_ID}, headers=headers
        )
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "7"
