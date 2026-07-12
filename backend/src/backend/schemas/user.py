import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Username = Annotated[
    str, StringConstraints(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
]
NormalizedEmail = Annotated[EmailStr, StringConstraints(to_lower=True)]


class UserBase(BaseModel):
    username: Username
    email: NormalizedEmail


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool


class UserUpdate(BaseModel):
    username: Username | None = None
    email: NormalizedEmail | None = None
