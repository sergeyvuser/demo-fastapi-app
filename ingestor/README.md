# ingestor

Streams Bybit ticker updates into RabbitMQ. The only entry point of market
data into the system.

```
Bybit WebSocket ──► ingestor ──► exchange "ticks" (topic, routing key = symbol)
```

- **Entry point**: `ingestor.app:app`, run with `faststream run` (`make ingestor`).
- **Publishes**: `TickEvent` (see `shared.events`) — symbol, price, exchange timestamp.
- **Consumes**: nothing. No database, no Redis.
- **Config**: `APP_CONFIG__STREAM__*` (ws url, symbols, reconnect delay) plus the
  shared infra sections (rabbitmq, log, otel).

## Reliability

The WebSocket pump is supervised: dropped connections reconnect inside
`stream_ticks`, and any other failure (broker outage, unexpected error) restarts
the whole pump loop instead of silently killing the background task.

Ticks are ephemeral by design — the evaluator queue drops them after 60s,
because a stale price is worthless.

See the [root README](../README.md) for the full picture and quickstart.
