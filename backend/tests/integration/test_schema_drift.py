from typing import Any

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection

from backend.models import Base


def _schema_diff(sync_connection: Connection) -> list[Any]:
    # same options env.py uses, so the test compares by the rules the real
    # `alembic revision --autogenerate` would apply
    context = MigrationContext.configure(
        sync_connection,
        opts={"compare_server_default": True},
    )
    return compare_metadata(context, Base.metadata)


async def test_models_and_migrations_agree(db_engine) -> None:
    """`alembic revision --autogenerate` must have nothing to say."""
    async with db_engine.connect() as connection:
        diff = await connection.run_sync(_schema_diff)

    assert diff == []
