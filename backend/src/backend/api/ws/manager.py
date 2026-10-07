import asyncio
import contextlib
import uuid
from collections import defaultdict
from collections.abc import AsyncGenerator
from typing import Any, TypedDict

from fastapi import WebSocket, status

from backend.api.ws.messages import CLOSE_REPLACED, TickMessage, TriggerMessage
from shared.events import AlertTriggeredEvent, TickEvent
from shared.metrics import ws_connections, ws_ticks_dropped

_QUEUE_SIZE = 100
# Insurance for one 512 MB instance against a tab multiplied by a script, not
# a product rule: one socket per tab, with hidden tabs releasing theirs, leaves
# a real person holding one to three.
MAX_SOCKETS_PER_USER = 5
# One flush for the whole process, every connection on the same cadence.
# Invisible to a person, and it bounds a socket to four Ticks a second per
# watched Symbol however fast the exchange moves.
SAMPLE_INTERVAL_SECONDS = 0.25


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
        self.close_code: int | None = None
        self._closing = asyncio.Event()

    def request_close(self, code: int) -> None:
        """Ask this connection's own endpoint to close it, with `code`.

        Nobody else may call ws.close(): under Granian a close issued while
        the endpoint is waiting in receive() never returns — the socket stays
        open and the caller hangs. The endpoint closes it itself, after it has
        stopped receiving. The first request wins.
        """
        if self.close_code is None:
            self.close_code = code
            self._closing.set()

    async def closing(self) -> int:
        """Wait until a close has been requested; return its code."""
        await self._closing.wait()
        assert self.close_code is not None
        return self.close_code

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
        # A dict used as an ordered set: iteration follows registration, so a
        # User's first connection found in it is that User's oldest.
        self._connections: dict[Connection, None] = {}
        # the latest Tick per Symbol since the last flush
        self._pending: dict[str, TickEvent] = {}

    def register(self, conn: Connection) -> None:
        """Take on a connection, closing the User's oldest beyond the cap."""
        mine = [c for c in self._connections if c.user_id == conn.user_id]
        excess = len(mine) - MAX_SOCKETS_PER_USER + 1
        for old in mine[: max(excess, 0)]:
            # counted out now rather than when its endpoint notices the close,
            # so the next registration cannot count it twice
            self.unregister(old)
            old.request_close(CLOSE_REPLACED)
        self._connections[conn] = None
        ws_connections.inc()

    def unregister(self, conn: Connection) -> None:
        """Idempotent: an evicted connection comes through here twice — from
        register, and again from its own endpoint's `finally`."""
        if conn in self._connections:
            del self._connections[conn]
            ws_connections.dec()

    def disconnect_user(self, user_id: uuid.UUID) -> None:
        """Close every socket this User holds, on every device.

        SINGLE-INSTANCE ONLY. This sees the sockets of this process and no
        other: with a second API replica, a logout handled by one replica
        leaves the User's sockets on the other open. Scaling out means
        replacing this with a broadcast (e.g. a "user signed out" event every
        replica consumes) — until then `api` must stay one container.
        """
        for conn in self._connections:
            if conn.user_id == user_id:
                conn.request_close(status.WS_1008_POLICY_VIOLATION)

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

    def offer_tick(self, tick: TickEvent) -> None:
        """Hold a Tick for the next flush; a newer one for its Symbol replaces it.

        Only the socket fan-out is sampled. The evaluator reads every Tick
        from a broker queue of its own, and nothing here sits on that path.
        """
        if tick.symbol in self._pending:
            ws_ticks_dropped.labels(tick.symbol).inc()
        self._pending[tick.symbol] = tick

    def flush(self) -> None:
        """Send the held Ticks to their watchers: one message per Symbol."""
        pending, self._pending = self._pending, {}
        for tick in pending.values():
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

    async def _sample_forever(self) -> None:
        while True:
            await asyncio.sleep(SAMPLE_INTERVAL_SECONDS)
            self.flush()

    @contextlib.asynccontextmanager
    async def sampling(self) -> AsyncGenerator[None]:
        """Run the sampler for as long as the block lasts — the app's lifespan."""
        task = asyncio.create_task(self._sample_forever())
        try:
            yield
        finally:
            task.cancel()

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
