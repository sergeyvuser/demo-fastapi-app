import uuid

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession


# ModelT — for SQLAlchemy, CreateSchemaT/UpdateSchemaT — for Pydantic
class BaseRepository[ModelT, CreateSchemaT: BaseModel, UpdateSchemaT: BaseModel]:
    def __init__(self, model: type[ModelT], session: AsyncSession):
        self.model = model
        self.session = session

    async def get_by_id(self, item_id: uuid.UUID | int) -> ModelT | None:
        return await self.session.get(self.model, item_id)

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

    async def remove(self, db_obj: ModelT) -> None:
        """Delete an object the caller has already loaded. The caller commits.

        Takes the object, not an id: loading it is where ownership is checked,
        and an id-based delete would re-fetch it blind to the owner.
        """
        await self.session.delete(db_obj)
        await self.session.flush()
