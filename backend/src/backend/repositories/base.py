import uuid
from collections.abc import Sequence

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


# ModelT — for SQLAlchemy, CreateSchemaT/UpdateSchemaT — for Pydantic
class BaseRepository[ModelT, CreateSchemaT: BaseModel, UpdateSchemaT: BaseModel]:
    def __init__(self, model: type[ModelT], session: AsyncSession):
        self.model = model
        self.session = session

    async def get_by_id(self, item_id: uuid.UUID | int) -> ModelT | None:
        return await self.session.get(self.model, item_id)

    async def get_multi(self, skip: int = 0, limit: int = 100) -> Sequence[ModelT]:
        stmt = (
            select(self.model)
            .order_by(self.model.id)  # type: ignore[attr-defined]
            .offset(skip)
            .limit(limit)
        )
        result = await self.session.scalars(stmt)
        return result.all()

    async def create(self, schema: CreateSchemaT) -> ModelT:
        db_obj = self.model(**schema.model_dump())
        self.session.add(db_obj)
        await self.session.flush()
        await self.session.refresh(db_obj)
        return db_obj

    async def update(self, db_obj: ModelT, schema: UpdateSchemaT) -> ModelT:
        update_data = schema.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        await self.session.flush()
        await self.session.refresh(db_obj)
        return db_obj

    async def delete(self, item_id: uuid.UUID | int) -> bool:
        db_obj = await self.get_by_id(item_id)
        if not db_obj:
            return False

        await self.session.delete(db_obj)
        await self.session.flush()
        return True
