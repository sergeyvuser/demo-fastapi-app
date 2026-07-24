"""Realtime layer: pushes ticks and alert events to WebSocket clients.

A per-instance bridge, NOT a competing consumer. This api process binds
its own auto-delete queues to the shared `ticks`/`alerts` exchanges, so
every api replica receives a COPY of each message (fan-out) — it never
steals events from the notifier or from another replica. Queues die with
the process (auto_delete); nothing accumulates for a dead instance.

Rules:
- authenticate BEFORE `websocket.accept()` — a bad token is a rejected
  handshake (close 1008), never an accepted-then-closed socket;
- outbound delivery is per-connection and bounded (drop-oldest): a slow
  client loses stale ticks, it must never block the broadcaster or grow
  server memory — freshness beats completeness for market data;
- authorization is per-message: ticks are filtered by the connection's
  symbol subscriptions, alert events by the connection's user_id — a
  socket must never receive another user's alerts;
- every connection owns a sender task; the receive loop's `finally` MUST
  cancel it and unregister the connection, or the broadcaster writes into
  a dead socket.
"""
