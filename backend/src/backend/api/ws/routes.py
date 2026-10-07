import asyncio
import contextlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from backend.api.ws.manager import Connection, manager
from backend.api.ws.messages import (
    AuthFrame,
    ErrorMessage,
    ServerMessage,
    UnwatchFrame,
    WatchFrame,
    WatchingMessage,
    client_frame,
)
from backend.core.config import settings
from backend.core.db import SessionFactory, SessionFactoryDep
from backend.services.auth import Authenticated, AuthService, InvalidAccessTokenError

router = APIRouter(tags=["WS"])

# How long an accepted socket may stay anonymous. The price of accepting
# before authenticating: a bounded window of connections nobody vouched for.
AUTH_DEADLINE_SECONDS = 5.0


def _loop_deadline(expires_at: datetime) -> float:
    """Translate a calendar instant into the event loop's clock.

    asyncio schedules on a monotonic clock unrelated to the calendar, and a
    token's expiry is a calendar instant: what carries over is the distance.
    """
    remaining = (expires_at - datetime.now(UTC)).total_seconds()
    return asyncio.get_running_loop().time() + remaining


async def _send(ws: WebSocket, message: ServerMessage) -> None:
    await ws.send_json(message.model_dump(mode="json"))


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
    frame: AuthFrame, user_id: uuid.UUID, sessions: SessionFactory
) -> Authenticated | None:
    """A fresh auth frame on an open socket: the same rule, and the same User.

    Another User's token is refused rather than adopted: the connection's
    user_id decides whose Triggers it receives, and switching it mid-socket
    is what a reconnect is for.
    """
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
        # frame moves the deadline — see the AuthFrame case below.
        async with asyncio.timeout_at(
            _loop_deadline(authenticated.expires_at)
        ) as lifetime:
            while True:
                try:
                    frame = client_frame.validate_json(await ws.receive_text())
                except ValidationError, KeyError:
                    # a client bug, or a tab left open across a deploy: say
                    # so and keep serving — closing would make it a reconnect loop
                    await _send(ws, ErrorMessage(code="invalid_frame"))
                    continue
                match frame:
                    case AuthFrame():
                        renewed = await _renew(frame, conn.user_id, sessions)
                        if renewed is None:
                            close_code = status.WS_1008_POLICY_VIOLATION
                            break
                        lifetime.reschedule(_loop_deadline(renewed.expires_at))
                        # no reply: the message union has no member for it,
                        # and a socket that stays open is the confirmation
                        continue
                    case WatchFrame(symbols=symbols):
                        requested = {s.upper() for s in symbols}
                        unknown = {
                            s for s in requested if s not in settings.subscription
                        }
                        if unknown:
                            # never a close: a typo is not a policy violation
                            await _send(
                                ws,
                                ErrorMessage(
                                    code="unknown_symbols", symbols=sorted(unknown)
                                ),
                            )
                        conn.symbols |= requested - unknown
                    case UnwatchFrame(symbols=symbols):
                        conn.symbols -= {s.upper() for s in symbols}
                await _send(ws, WatchingMessage(symbols=sorted(conn.symbols)))
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
