from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
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
