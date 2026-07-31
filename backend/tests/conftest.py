"""Database fixtures: a throwaway Postgres in Docker, migrated once per session.

Helpers live here as fixtures on purpose: test directories are not importable
packages (they sit outside `src/`), so a shared `factories.py` next to the
tests could not be imported from them. conftest is the sanctioned way to share
code between test modules.
"""

import uuid
from collections.abc import AsyncGenerator, Callable, Generator
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from polyfactory.factories.pydantic_factory import ModelFactory
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from backend.core import security
from backend.core.config import settings
from backend.core.db import AsyncSessionLocal, get_async_db_session, make_engine
from backend.main import app as fastapi_app
from backend.models import User
from backend.schemas.alert import AlertCreate
from backend.tasks.email import send_verification_email

BACKEND_DIR = Path(__file__).parents[1]

PASSWORD = "correct-horse-battery-staple"


@pytest.fixture
def password() -> str:
    return PASSWORD


def pytest_collection_modifyitems(items) -> None:
    """Anything under tests/integration needs Docker - mark it automatically."""
    for item in items:
        if "integration" in item.path.parts:
            item.add_marker("integration")


@pytest.fixture(scope="session")
def postgres_dsn() -> Generator[str]:
    # Same image tag as compose runs: tests and production meet the same server.
    with PostgresContainer("postgres:18-alpine") as container:
        host = container.get_container_host_ip()
        # Docker Desktop on Windows reports "localhost", which resolves to ::1
        # while the port is published on IPv4 only — the stage 5 trap again.
        host = "127.0.0.1" if host == "localhost" else host
        yield (
            f"postgresql+asyncpg://{container.username}:{container.password}"
            f"@{host}:{container.get_exposed_port(5432)}/{container.dbname}"
        )


@pytest.fixture(scope="session")
def _migrated_db(postgres_dsn: str) -> Generator[None]:
    """Bring the container's schema to head — and prove the migrations run.

    Deliberately a SYNC fixture: alembic's env.py calls asyncio.run(), which
    explodes if there is already a running loop.
    """
    url = make_url(postgres_dsn)
    with pytest.MonkeyPatch.context() as mp:
        # env.py builds its engine from `settings`, not from the ini file, so
        # the settings object is the only place where it can be redirected.
        mp.setattr(settings.db, "host", url.host)
        mp.setattr(settings.db, "port", url.port)
        mp.setattr(settings.db, "name", url.database)
        mp.setattr(settings.db, "username", url.username)
        mp.setattr(settings.db, "password", SecretStr(url.password))

        command.upgrade(
            Config(
                file_=BACKEND_DIR / "alembic.ini",
                toml_file=BACKEND_DIR / "pyproject.toml",  # holds script_location
            ),
            "head",
        )
        yield


@pytest.fixture(scope="session")
async def db_engine(_migrated_db: None) -> AsyncGenerator[AsyncEngine]:
    engine = make_engine(settings.db)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(db_engine: AsyncEngine) -> AsyncGenerator[AsyncSession]:
    """One test = one transaction that never reaches disk.

    The session is bound to a connection that is ALREADY in a transaction.
    `create_savepoint` makes the session open a SAVEPOINT instead of joining
    that transaction, so a `commit()` inside the service layer only releases
    the savepoint — the outer rollback below still wipes everything.

    Everything else (expire_on_commit and whatever the app adds later) comes
    from the application's own sessionmaker: only the bind and the join mode
    are test-specific.
    """
    async with db_engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSessionLocal(
            bind=connection,
            join_transaction_mode="create_savepoint",
        ) as session:
            yield session
        await transaction.rollback()


@pytest.fixture(scope="session")
def redis_dsn() -> Generator[str]:
    # same tag as compose: Lua scripting and expiry semantics must match
    with RedisContainer("redis:8-alpine") as container:
        host = container.get_container_host_ip()
        yield f"redis://{host}:{container.get_exposed_port(6379)}/0"


@pytest.fixture(scope="session")
async def redis_client(redis_dsn: str) -> AsyncGenerator[Redis]:
    client = Redis.from_url(redis_dsn, decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
async def api_client(
    session: AsyncSession, redis_client: Redis
) -> AsyncGenerator[AsyncClient]:
    """HTTP client that drives the app in-process.

    ASGITransport speaks ASGI directly: no socket, no server — and NO
    lifespan. Everything lifespan would have wired up has to be supplied
    here by hand, which is exactly what the three lines below do.
    """
    # the counter for rate limiting outlives a single test otherwise
    await redis_client.flushdb()

    fastapi_app.dependency_overrides[get_async_db_session] = lambda: session
    fastapi_app.state.redis = redis_client

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as client:
        yield client

    fastapi_app.dependency_overrides.clear()


class AlertCreateFactory(ModelFactory[AlertCreate]):
    # symbol and threshold are constrained types; polyfactory can satisfy them
    # on its own, but pinned values keep assertion failures readable
    symbol = "BTCUSDT"
    threshold = Decimal("64000.00000001")
    cooldown_seconds = 3600


@pytest.fixture
def alert_factory() -> type[AlertCreateFactory]:
    return AlertCreateFactory


async def _create_user(session: AsyncSession, **overrides) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        username=overrides.pop("username", f"user-{suffix}"),
        email=overrides.pop("email", f"{suffix}@example.com"),
        hashed_password=overrides.pop("hashed_password", "not-a-real-hash"),
        **overrides,
    )
    session.add(user)
    await session.flush()  # assigns the id; still inside the savepoint
    return user


@pytest.fixture
async def user(session: AsyncSession) -> User:
    return await _create_user(session, telegram_chat_id=424242)


@pytest.fixture
async def other_user(session: AsyncSession) -> User:
    return await _create_user(session)


@pytest.fixture
async def verified_user(session: AsyncSession) -> User:
    return await _create_user(session, telegram_chat_id=424242, is_verified=True)


@pytest.fixture
async def user_with_password(session: AsyncSession) -> User:
    return await _create_user(session, hashed_password=security.hash_password(PASSWORD))


@pytest.fixture
def auth_headers() -> Callable[[User], dict[str, str]]:
    """Mint a bearer header for any user — no login round-trip needed."""
    return lambda user: {
        "Authorization": f"Bearer {security.create_access_token(user.id)}"
    }


@pytest.fixture
def enqueued_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Capture verification tasks instead of publishing them.

    The API process is a taskiq CLIENT, and its broker is started by the
    lifespan we are not running — .kiq() would fail on a closed connection.
    What matters at this layer is that the task WAS handed over with the
    right arguments; running it is part 4's job.
    """
    sent: list[dict] = []

    async def fake_kiq(**kwargs) -> None:
        sent.append(kwargs)

    monkeypatch.setattr(send_verification_email, "kiq", fake_kiq)
    return sent
