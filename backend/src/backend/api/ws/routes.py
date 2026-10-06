import asyncio
import contextlib
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError

from backend.api.ws.manager import Connection, manager
from backend.core.db import SessionFactory, SessionFactoryDep
from backend.services.auth import Authenticated, AuthService, InvalidAccessTokenError

router = APIRouter(tags=["WS"])

# How long an accepted socket may stay anonymous. The price of accepting
# before authenticating: a bounded window of connections nobody vouched for.
AUTH_DEADLINE_SECONDS = 5.0


class AuthFrame(BaseModel):
    action: Literal["auth"]
    token: str


def _loop_deadline(expires_at: datetime) -> float:
    """Translate a calendar instant into the event loop's clock.

    asyncio schedules on a monotonic clock unrelated to the calendar, and a
    token's expiry is a calendar instant: what carries over is the distance.
    """
    remaining = (expires_at - datetime.now(UTC)).total_seconds()
    return asyncio.get_running_loop().time() + remaining


async def _verify(token: str, sessions: SessionFactory) -> Authenticated | None:
    try:
        # a session for this check only: one from Depends would live as long
        # as the socket, holding a pooled connection for hours
        async with sessions() as session:
            return await AuthService(session).authenticate(token)
    except InvalidAccessTokenError:
        return None


async def _authenticate(
    ws: WebSocket, sessions: SessionFactory
) -> Authenticated | None:
    """Wait for the auth frame and check it by the same rule as HTTP.

    None means "close it": no frame in time, a frame that is not auth, or a
    token the rule refuses. The client gets one close code for all three.
    """
    try:
        async with asyncio.timeout(AUTH_DEADLINE_SECONDS):
            frame = AuthFrame.model_validate_json(await ws.receive_text())
    except TimeoutError, ValidationError, KeyError:
        # KeyError: a binary frame, which receive_text cannot read
        return None
    return await _verify(frame.token, sessions)


async def _renew(
    msg: Any, user_id: uuid.UUID, sessions: SessionFactory
) -> Authenticated | None:
    """A fresh auth frame on an open socket: the same rule, and the same User.

    Another User's token is refused rather than adopted: the connection's
    user_id decides whose Triggers it receives, and switching it mid-socket
    is what a reconnect is for.
    """
    try:
        frame = AuthFrame.model_validate(msg)
    except ValidationError:
        return None
    renewed = await _verify(frame.token, sessions)
    if renewed is None or renewed.user.id != user_id:
        return None
    return renewed


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, sessions: SessionFactoryDep) -> None:
    # Accept first, authenticate in-band: a credential in the URL lands in the
    # edge's access log and in the server span's http.url.
    await ws.accept()
    try:
        authenticated = await _authenticate(ws, sessions)
    except WebSocketDisconnect:
        return  # left before saying who it was: nothing to close or unregister
    if authenticated is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # registered only now: until here the manager has nothing to send it to
    conn = Connection(ws=ws, user_id=authenticated.user.id)
    manager.register(conn)

    async def sender() -> None:
        while True:
            await ws.send_json(await conn.queue.get())

    send_task = asyncio.create_task(sender())
    close_code: int | None = None
    try:
        # The socket lives no longer than its credential. Only a fresh auth
        # frame moves the deadline — see the "auth" case below.
        async with asyncio.timeout_at(
            _loop_deadline(authenticated.expires_at)
        ) as lifetime:
            while True:
                msg = await ws.receive_json()
                symbols = {s.upper() for s in msg.get("symbols", [])}
                match msg.get("action"):
                    case "auth":
                        renewed = await _renew(msg, conn.user_id, sessions)
                        if renewed is None:
                            close_code = status.WS_1008_POLICY_VIOLATION
                            break
                        lifetime.reschedule(_loop_deadline(renewed.expires_at))
                        # no reply: the message union has no member for it,
                        # and a socket that stays open is the confirmation
                        continue
                    case "subscribe":
                        conn.symbols |= symbols
                    case "unsubscribe":
                        conn.symbols -= symbols
                await ws.send_json(
                    {"type": "subscriptions", "symbols": sorted(conn.symbols)}
                )
    except TimeoutError:
        # the token expired and no fresh one arrived in time
        close_code = status.WS_1008_POLICY_VIOLATION
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        manager.unregister(conn)
        if close_code is not None:
            # the client may already be gone; that must not mask the cleanup
            with contextlib.suppress(RuntimeError, OSError):
                await ws.close(code=close_code)
