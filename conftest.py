"""Deterministic environment for the whole test suite.

Every service validates its settings AT IMPORT time (`settings = Settings()`
at module level), so the environment must be ready before the first
`backend.*` import. pytest loads the root conftest before collecting test
modules — this is the earliest hook available.

Assignment is explicit, not `setdefault`: environment variables outrank the
dotenv file in pydantic-settings, so this also shields the run from whatever
sits in the developer's local .env. A test suite that passes only on the
machine that has the right .env is not a test suite.
"""

import os
import sys
from collections.abc import AsyncGenerator, Generator

import pytest
from redis.asyncio import Redis
from testcontainers.community.redis import RedisContainer

os.environ.update(
    {
        "APP_CONFIG__DB__NAME": "test",
        "APP_CONFIG__DB__USERNAME": "test",
        "APP_CONFIG__DB__PASSWORD": "test",
        "APP_CONFIG__DB__HOST": "127.0.0.1",
        "APP_CONFIG__DB__PORT": "5432",
        "APP_CONFIG__DB__SQLA__ECHO": "false",
        "APP_CONFIG__AUTH__SECRET_KEY": "test-secret-key-not-for-production",
        "APP_CONFIG__RABBITMQ__PASSWORD": "test",
        # no exporter, no background export thread during tests
        "APP_CONFIG__OTEL__ENABLED": "false",
        "APP_CONFIG__LOG__LEVEL": "WARNING",
        # testing
        "APP_CONFIG__TESTING": "true",
        "APP_CONFIG__TELEGRAM__BOT_TOKEN": "123456:test-token",
        # Ryuk is testcontainers' crash-cleanup sidekick: it starts before
        # everything else and reaps containers if pytest dies without running
        # teardown. On Docker Desktop for Windows its published port is
        # regularly unreachable from the host — it is the first container of
        # the session and the port proxy is not warm yet — and the whole run
        # dies in its 50-second retry loop.
        #
        # Our fixtures stop their containers themselves, so the only thing
        # lost is cleanup after a hard kill. Kept enabled everywhere else,
        # notably in CI, where it works and matters more.
        **({"TESTCONTAINERS_RYUK_DISABLED": "true"} if sys.platform == "win32" else {}),
    }
)


@pytest.fixture(scope="session")
def redis_endpoint() -> Generator[tuple[str, int]]:
    """Redis for every service that needs one — backend and notifier alike."""
    # same tag as compose: Lua scripting and expiry semantics must match
    with RedisContainer("redis:8-alpine") as container:
        host = container.get_container_host_ip()
        yield host, int(container.get_exposed_port(6379))


@pytest.fixture(scope="session")
async def redis_client(redis_endpoint: tuple[str, int]) -> AsyncGenerator[Redis]:
    host, port = redis_endpoint
    client = Redis.from_url(f"redis://{host}:{port}/0", decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
async def clean_redis(redis_client: Redis) -> Redis:
    """Redis with no leftovers: dedup keys and rate-limit counters must not
    survive into the next test."""
    await redis_client.flushdb()
    return redis_client


def pytest_collection_modifyitems(items) -> None:
    """Anything under tests/integration needs Docker - mark it automatically."""
    for item in items:
        if "integration" in item.path.parts:
            item.add_marker("integration")
