from faststream.exceptions import RejectMessage
from faststream.rabbit import RabbitBroker, RabbitQueue

from shared.broker import (
    ALERTS_DEAD_QUEUE,
    ALERTS_EXCHANGE,
    ALERTS_TRIGGERED_QUEUE,
    declare_alerts_topology,
)

EVENT = {"alert_id": "00000000-0000-0000-0000-000000000001", "symbol": "BTCUSDT"}


async def test_rejected_alert_is_dead_lettered(
    rabbit_broker: RabbitBroker, wait_message
) -> None:
    """The incident from stage 6, turned into a regression test.

    A reject with requeue=False is only half the story: the message survives
    solely because the queue carries x-dead-letter-exchange AND that exchange
    exists. Break either and the message vanishes without a trace.
    """

    @rabbit_broker.subscriber(ALERTS_TRIGGERED_QUEUE, ALERTS_EXCHANGE)
    async def always_reject(event: dict) -> None:
        raise RejectMessage

    # the subscriber declares the alerts exchange, its queue and the binding;
    # this is where the broker validates x-dead-letter-exchange
    await rabbit_broker.start()  # declares the queue with its arguments

    # production code: adds the dead-letter exchange and queue. Without this
    # call the reject below would drop the message silently — stage 6, exactly
    await declare_alerts_topology(rabbit_broker)

    # AMQP has no "get queue": an idempotent declare IS the lookup
    dead_queue = await rabbit_broker.declare_queue(ALERTS_DEAD_QUEUE)
    await dead_queue.purge()  # the container outlives a single test

    await rabbit_broker.publish(
        EVENT, exchange=ALERTS_EXCHANGE, routing_key="alert.triggered"
    )

    assert await wait_message(dead_queue) is not None


async def test_each_bound_queue_receives_its_own_copy(
    rabbit_broker: RabbitBroker, wait_message
) -> None:
    """Topic exchange fans out: the notifier and the WS bridge must not steal
    alerts from one another (stage 8). One queue = competition, two queues =
    a copy each."""
    await rabbit_broker.start()
    exchange = await rabbit_broker.declare_exchange(ALERTS_EXCHANGE)

    queues = []
    for name in ("alerts.copy.one", "alerts.copy.two"):
        queue = await rabbit_broker.declare_queue(
            RabbitQueue(name, auto_delete=True, exclusive=True)
        )
        await queue.bind(exchange, routing_key="alert.triggered")
        queues.append(queue)

    await rabbit_broker.publish(
        EVENT, exchange=ALERTS_EXCHANGE, routing_key="alert.triggered"
    )

    for queue in queues:
        assert await wait_message(queue) is not None


async def test_topology_survives_a_second_declaration(
    rabbit_broker: RabbitBroker,
) -> None:
    """Every service declares the topology at startup, so it is declared many
    times over. Mismatched arguments would fail here with PRECONDITION_FAILED."""
    await rabbit_broker.start()

    await declare_alerts_topology(rabbit_broker)
    await declare_alerts_topology(rabbit_broker)
