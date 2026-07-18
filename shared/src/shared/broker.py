from faststream.rabbit import ExchangeType, RabbitExchange, RabbitQueue
from faststream.rabbit.schemas.queue import ClassicQueueArgs

# Producers publish here. Topic exchange: routing key = symbol,
# so future consumers can subscribe to a single symbol if they want.
TICKS_EXCHANGE = RabbitExchange("ticks", type=ExchangeType.TOPIC, durable=True)

ALERTS_EXCHANGE = RabbitExchange("alerts", type=ExchangeType.TOPIC, durable=True)

_TICKS_QUEUE_ARGS: ClassicQueueArgs = {"x-message-ttl": 60_000}

# Evaluator's queue: "#" binds to all symbols. Ticks are ephemeral —
# a 60s TTL stops them from piling up while the evaluator is down
# (a fresh tick arrives every second anyway).
TICKS_EVALUATOR_QUEUE = RabbitQueue(
    "ticks.evaluator",
    routing_key="#",
    durable=True,
    arguments=_TICKS_QUEUE_ARGS,
)

# Triggered alerts are NOT ephemeral: if the notifier is down, they must
# wait for it. Durable queue, no TTL.
ALERTS_TRIGGERED_QUEUE = RabbitQueue(
    "alerts.triggered",
    routing_key="alert.triggered",
    durable=True,
)
