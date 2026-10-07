import asyncio
import contextlib
import uuid
from collections import defaultdict
from typing import Any, TypedDict

from fastapi import WebSocket, status

from backend.api.ws.messages import TickMessage, TriggerMessage
from shared.events import AlertTriggeredEvent, TickEvent
from shared.metrics import ws_connections

_QUEUE_SIZE = 100


class WsStats(TypedDict):
    connections: int
    unique_users: int
    watchers_by_symbol: dict[str, int]


class Connection:
    """One client: its socket, the Symbols it watches, its send queue."""

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
        ws_connections.inc()

    def unregister(self, conn: Connection) -> None:
        self._connections.discard(conn)
        ws_connections.dec()

    async def disconnect_user(self, user_id: uuid.UUID) -> None:
        """Close every socket this User holds, on every device.

        SINGLE-INSTANCE ONLY. This sees the sockets of this process and no
        other: with a second API replica, a logout handled by one replica
        leaves the User's sockets on the other open. Scaling out means
        replacing this with a broadcast (e.g. a "user signed out" event every
        replica consumes) — until then `api` must stay one container.
        """
        # a snapshot: each close lets the endpoint's `finally` unregister its
        # connection, which would change the set mid-iteration
        for conn in [c for c in self._connections if c.user_id == user_id]:
            # the client may be gone already; one dead socket must not leave
            # the rest open, nor fail the logout that asked for it
            with contextlib.suppress(RuntimeError, OSError):
                await conn.ws.close(code=status.WS_1008_POLICY_VIOLATION)

    @property
    def active_count(self) -> int:
        return len(self._connections)

    def stats(self) -> WsStats:
        by_symbol: dict[str, int] = defaultdict(int)
        for conn in self._connections:
            for s in conn.symbols:
                by_symbol[s] += 1
        return {
            "connections": len(self._connections),
            "unique_users": len({c.user_id for c in self._connections}),
            "watchers_by_symbol": dict(by_symbol),
        }

    async def broadcast_tick(self, tick: TickEvent) -> None:
        # built and dumped once: every watcher is handed the same dict
        message = TickMessage(
            symbol=tick.symbol,
            price=tick.price,
            reference_price=tick.reference_price,
            ts=tick.ts,
        ).model_dump(mode="json")
        for conn in self._connections:
            if tick.symbol in conn.symbols:
                conn.enqueue(message)

    async def send_trigger(self, event: AlertTriggeredEvent) -> None:
        # The event also carries user_id and telegram_chat_id — one routes it,
        # the other is the notifier's — and neither belongs on a browser's wire.
        message = TriggerMessage(
            trigger_id=event.trigger_id,
            alert_id=event.alert_id,
            symbol=event.symbol,
            condition=event.condition,
            threshold=event.threshold,
            price=event.price,
            triggered_at=event.triggered_at,
        ).model_dump(mode="json")
        # every socket of the owner, whatever it watches: a Trigger is the
        # User's, not the Symbol's
        for conn in self._connections:
            if conn.user_id == event.user_id:
                conn.enqueue(message)


manager = ConnectionManager()
