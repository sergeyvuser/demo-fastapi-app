from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager
from typing import Annotated, Any, cast

from fastapi import Depends
from sqlalchemy import CursorResult, Executable
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.core.config import DBConfig, settings


def make_engine(cfg: DBConfig) -> AsyncEngine:
    return create_async_engine(
        url=cfg.async_url,
        echo=cfg.sqla.echo,
        echo_pool=cfg.sqla.echo_pool,
        pool_pre_ping=cfg.sqla.pool_pre_ping,
        pool_size=cfg.sqla.pool_size,
        max_overflow=cfg.sqla.max_overflow,
    )


engine: AsyncEngine = make_engine(settings.db)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


async def get_async_db_session() -> AsyncGenerator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_db_session)]

# Something that opens a session: `async with factory() as session:`.
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


def get_session_factory() -> SessionFactory:
    """For code that outlives a request — the socket — and opens short
    sessions of its own instead of holding one from Depends for hours."""
    return AsyncSessionLocal


SessionFactoryDep = Annotated[SessionFactory, Depends(get_session_factory)]


async def rows_affected(session: AsyncSession, stmt: Executable) -> int:
    """Run a bulk UPDATE or DELETE and say how many rows it touched.

    The caller commits. One home for the cast below, which every bulk
    statement in the project otherwise repeats.
    """
    # DML execute returns a CursorResult at runtime; the signature says Result
    result = cast(CursorResult[Any], await session.execute(stmt))
    # rowcount is a SQLAlchemy memoized_property; PyCharm reads the raw function
    # noinspection PyTypeChecker
    return result.rowcount
