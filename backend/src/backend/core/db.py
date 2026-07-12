from typing import Annotated, AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.core.config import settings

engine: AsyncEngine = create_async_engine(
    url=settings.db.async_url,
    echo=settings.db.sqla.echo,  # log all statements
    echo_pool=settings.db.sqla.echo_pool,  # the connection pool will log informational output such as when connections are invalidated
    pool_pre_ping=settings.db.sqla.pool_pre_ping,  # the connection pool “pre-ping” feature that tests connections for liveness upon each checkout
    pool_size=settings.db.sqla.pool_size,  # the number of connections to keep open inside the connection pool
    max_overflow=settings.db.sqla.max_overflow,  # the number of connections to allow in connection pool “overflow”
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


async def get_async_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_db_session)]
