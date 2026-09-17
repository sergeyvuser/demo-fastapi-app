# RabbitMQ, not Kafka, carries the events between services

The services talk through RabbitMQ: the ingestor publishes every Tick to a topic exchange, each consumer
reads its own copy from its own queue, and the evaluator publishes Triggers on to the notifier. Kafka is
the name a reader most often expects for an event bus between services, so the choice is written down —
made at stage 6, recorded at stage 13 when the question was asked. It rests on what the two brokers are.
RabbitMQ is **queues**: a message is addressed to a queue, acknowledged one at a time, and then gone.
Kafka is a **log**: messages stay in a topic for a retention period, and each consumer only moves its own
offset along it. This project leans on the first model's features and has no use for the second's.

## Considered options

**Kafka** would carry the same traffic, and FastStream speaks it, so the handlers would barely change.
The fan-out maps cleanly too: one consumer group per consumer, and a unique group per API replica for the
socket. What does not map is what the topology in `shared/broker.py` depends on:

- **Per-queue message TTL.** `ticks.evaluator` discards Ticks older than sixty seconds (`x-message-ttl`),
  so an evaluator that was down resumes on current prices instead of replaying stale ones. Kafka's
  retention belongs to the topic, not to a consumer; the same guarantee would become a timestamp
  comparison inside every handler.
- **Dead-lettering.** A Trigger the notifier rejects is routed by the broker itself through `alerts.dlx`
  into `alerts.triggered.dead`, for a person to inspect. Kafka has no dead-letter routing for a plain
  consumer. FastStream's default for it commits the offset before the handler runs (`AckPolicy.ACK_FIRST`,
  at most once), and its retrying policy, `NACK_ON_ERROR`, re-reads a poison message indefinitely and
  stalls its partition behind it — so the dead-letter topic, and the rule for when to use it, would be
  written by hand.
- **Memory.** Kafka's start script reserves a JVM heap of `-Xmx1G -Xms1G` by default: a gigabyte taken at
  boot on the 4 GB host of [ADR 0001](0001-one-vps-with-docker-compose.md), where RabbitMQ runs capped at
  512M.

What Kafka would buy is replaying history and throughput across partitions and machines. Neither is
needed: two Symbols produce under three messages a second (measured in production), and nothing
reprocesses past events.

**The existing Redis cache as the channel** — the ingestor writes the latest price, consumers read it —
was never a way to move events, and is recorded because it looks like one. A key holds the latest value
and overwrites the rest, so a consumer that polls it misses every Tick between two reads: a price that
crosses a Threshold and falls back within one poll never fires the Alert, and a Condition defined against
*the previous Tick* cannot be evaluated at all. Nothing buffers while a consumer is down, and nothing
records what has already been handled. The cache stays, for the question it does answer: what a price is
right now.

## Consequences

- **The requirement that would reopen this is replay, not volume.** A price series to evaluate
  percent-change Conditions against, or Triggers rebuilt from past Ticks, would make a log worth its
  memory. Growth in Symbols or messages alone would not.
- **Swapping brokers costs more than the handlers.** The topology is declared in RabbitMQ's terms, the
  tests publish through FastStream's `TestRabbitBroker`, and the dead-letter path is proven against a live
  RabbitMQ container (`shared/tests/integration/test_alerts_topology.py`), because an in-memory test
  broker cannot dead-letter. All three would be rewritten, not translated.
