import asyncio
import uuid

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from backend.api.ws.manager import Connection, manager
from backend.core import security

router = APIRouter(tags=["WS"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str) -> None:
    # 1. Authenticate BEFORE accept: bad token → handshake rejected.
    try:
        payload = security.decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except jwt.InvalidTokenError, KeyError, ValueError:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    conn = Connection(ws=ws, user_id=user_id)
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
