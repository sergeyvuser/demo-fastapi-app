"""The socket's opening: an auth frame, checked like HTTP, before anything else."""

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime

import pytest
from fastapi import status
from httpx_ws import AsyncWebSocketSession, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.ws import routes
from backend.api.ws.manager import manager
from backend.core import security
from backend.models.user import User

Connect = Callable[[], AbstractAsyncContextManager[AsyncWebSocketSession]]
POLICY_VIOLATION = status.WS_1008_POLICY_VIOLATION


def _auth(user: User) -> dict[str, str]:
    return {"action": "auth", "token": security.create_access_token(user.id)}


async def _close_code(ws: AsyncWebSocketSession) -> int:
    """Wait for the server to close the socket, and say with what code."""
    with pytest.raises(WebSocketDisconnect) as closed:
        await ws.receive_json(timeout=2)
    return closed.value.code


async def test_an_auth_frame_opens_the_socket(ws_connect: Connect, user: User) -> None:
    before = manager.active_count
    async with ws_connect() as ws:
        await ws.send_json(_auth(user))
        await ws.send_json({"action": "subscribe", "symbols": ["BTCUSDT"]})
        # an answer at all means the socket was authenticated and is served
        assert (await ws.receive_json(timeout=2))["symbols"] == ["BTCUSDT"]
        assert manager.active_count == before + 1


async def test_a_bad_token_closes_with_1008(ws_connect: Connect) -> None:
    async with ws_connect() as ws:
        await ws.send_json({"action": "auth", "token": "not-a-jwt"})
        assert await _close_code(ws) == POLICY_VIOLATION


async def test_a_token_issued_before_a_logout_cannot_open_a_socket(
    ws_connect: Connect, user: User, session: AsyncSession
) -> None:
    frame = _auth(user)
    user.tokens_valid_from = datetime.now(UTC)  # what a logout writes
    await session.flush()
    async with ws_connect() as ws:
        await ws.send_json(frame)
        assert await _close_code(ws) == POLICY_VIOLATION


async def test_nothing_is_served_before_the_auth_frame(ws_connect: Connect) -> None:
    async with ws_connect() as ws:
        await ws.send_json({"action": "subscribe", "symbols": ["BTCUSDT"]})
        assert await _close_code(ws) == POLICY_VIOLATION


async def test_silence_past_the_deadline_closes_with_1008(
    ws_connect: Connect, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(routes, "AUTH_DEADLINE_SECONDS", 0.2)
    before = manager.active_count
    async with ws_connect() as ws:
        # accepted, but anonymous: the manager must not know it exists
        assert manager.active_count == before
        assert await _close_code(ws) == POLICY_VIOLATION
