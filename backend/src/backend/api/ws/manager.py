import asyncio
import contextlib
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from loguru import logger

from shared.events import AlertTriggeredEvent, TickEvent

_QUEUE_SIZE = 100


class Connection:
    """One client: its socket, its subscriptions, its send queue."""

    def __init__(self, ws: WebSocket, user_id: uuid.UUID) -> None:
        self.ws = ws
        self.user_id = user_id
        self.symbols: set[str] = set()
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_SIZE)

    def enqueue(self, message: dict[str, Any]) -> None:
        """Drop-oldest backpressure: a slow client loses stale ticks,
        never blocks the broadcaster and never grows memory unbounded."""
        while True:
            try:
                self.queue.put_nowait(message)
                return
            except asyncio.QueueFull:
                with contextlib.suppress(asyncio.QueueEmpty):
                    self.queue.get_nowait()


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[Connection] = set()

    def register(self, conn: Connection) -> None:
        self._connections.add(conn)

    def unregister(self, conn: Connection) -> None:
        self._connections.discard(conn)

    @property
    def active_count(self) -> int:
        return len(self._connections)

    def stats(self) -> dict[str, int]:
        by_symbol: dict[str, int] = defaultdict(int)
        for conn in self._connections:
            for s in conn.symbols:
                by_symbol[s] += 1
        return {
            "connections": len(self._connections),
            "unique_users": len({c.user_id for c in self._connections}),
            "subscriptions_by_symbol": dict(by_symbol),
        }

    async def broadcast_tick(self, tick: TickEvent) -> None:
        message = {
            "type": "tick",
            "symbol": tick.symbol,
            "price": str(tick.price),
            "ts": tick.ts.isoformat(),
        }
        for conn in self._connections:
            if tick.symbol in conn.symbols:
                conn.enqueue(message)

    async def send_alert(self, event: AlertTriggeredEvent) -> None:
        message = {
            "type": "alert",
            "alert_id": str(event.alert_id),
            "symbol": event.symbol,
            "condition": event.condition,
            "threshold": str(event.threshold),
            "price": str(event.price),
            "triggered_at": event.triggered_at.isoformat(),
        }
        for conn in self._connections:
            if conn.user_id == event.user_id:
                conn.enqueue(message)


manager = ConnectionManager()
