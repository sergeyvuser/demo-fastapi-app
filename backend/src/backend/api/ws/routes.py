import asyncio
from typing import Literal

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
    try:
        # a session for this check only: one from Depends would live as long
        # as the socket, holding a pooled connection for hours
        async with sessions() as session:
            return await AuthService(session).authenticate(frame.token)
    except InvalidAccessTokenError:
        return None


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
    try:
        # 2. Receive loop: subscription management.
        while True:
            msg = await ws.receive_json()
            symbols = {s.upper() for s in msg.get("symbols", [])}
            match msg.get("action"):
                case "subscribe":
                    conn.symbols |= symbols
                case "unsubscribe":
                    conn.symbols -= symbols
            await ws.send_json(
                {"type": "subscriptions", "symbols": sorted(conn.symbols)}
            )
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        manager.unregister(conn)
