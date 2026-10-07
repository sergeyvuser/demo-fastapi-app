"""Realtime layer: pushes Ticks and Triggers to WebSocket clients.

A per-instance bridge, NOT a competing consumer. This api process binds
its own auto-delete queues to the shared `ticks`/`alerts` exchanges, so
every api replica receives a COPY of each message (fan-out) — it never
steals events from the notifier or from another replica. Queues die with
the process (auto_delete); nothing accumulates for a dead instance.

The wire contract — every frame, both unions, the close codes — is
messages.py.

Rules:
- accept first, authenticate in-band: the first frame must be
  `{"action": "auth", "token": ...}` within AUTH_DEADLINE_SECONDS, checked
  by the same rule as HTTP (AuthService.authenticate). Anything else closes
  with 1008, and the connection is registered with the manager only once it
  verifies — an anonymous socket is never served;
- a socket lives no longer than its token: the receive loop runs under a
  deadline at `exp`, and only a fresh auth frame for the same User moves it;
- only a connection's own endpoint closes its socket. Anyone else calls
  Connection.request_close: under Granian, a close issued from another task
  while the endpoint waits in receive() never returns;
- Ticks reach sockets through one 250 ms sampler, latest per Symbol wins.
  The broker is never throttled: the evaluator reads every Tick from a
  queue of its own;
- outbound delivery is per-connection and bounded (drop-oldest) — the
  overflow valve for a slow client, not the rate;
- authorization is per-message: Ticks are filtered by the Symbols the
  connection watches, Triggers by its user_id — a socket must never receive
  another user's Triggers;
- every connection runs three tasks — receive loop, close waiter, sender —
  and the endpoint's `finally` cancels and awaits all three before it
  closes the socket and unregisters the connection.
"""
