"""Live RabbitMQ for the topology tests.

TestBroker delivers messages in memory: it never validates queue arguments
and knows nothing about dead-lettering, because those are behaviours of the
broker itself rather than of our handlers. The only way to test them is to
talk to a real one.
"""

import asyncio
from collections.abc import AsyncGenerator, Generator

import pytest
from faststream.rabbit import RabbitBroker
from testcontainers.core.container import DockerContainer
from testcontainers.core.wait_strategies import LogMessageWaitStrategy


@pytest.fixture(scope="session")
def rabbit_url() -> Generator[str]:
    container = (
        # same image as compose: queue argument validation is version-specific
        DockerContainer("rabbitmq:4-management-alpine")
        .with_env("RABBITMQ_DEFAULT_USER", "test")
        .with_env("RABBITMQ_DEFAULT_PASS", "test")
        .with_exposed_ports(5672)
        # no python client to probe with (pika is not a dependency here) and
        # rabbit needs ~10s to boot, so its own log line is the readiness
        # signal; the strategy is applied by start()
        .waiting_for(
            LogMessageWaitStrategy("Server startup complete").with_startup_timeout(120)
        )
    )
    with container:
        host = container.get_container_host_ip()
        yield f"amqp://test:test@{host}:{container.get_exposed_port(5672)}/"


@pytest.fixture
async def rabbit_broker(rabbit_url: str) -> AsyncGenerator[RabbitBroker]:
    """An UNSTARTED broker: subscribers must be registered before start()."""
    broker = RabbitBroker(rabbit_url)
    yield broker
    await broker.stop()


async def wait_for_message(queue):
    """Poll a queue until a message shows up.

    Dead-lettering is asynchronous — the broker moves the message only after
    the reject is confirmed, so there is nothing to await on directly. The
    deadline belongs to the caller: asyncio.timeout composes, a parameter
    would not.
    """
    while True:
        message = await queue.get(no_ack=True, fail=False)
        if message is not None:
            return message
        await asyncio.sleep(0.1)


@pytest.fixture
def wait_message():
    return wait_for_message
