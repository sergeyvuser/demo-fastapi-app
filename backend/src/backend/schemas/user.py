import uuid
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    computed_field,
)

from backend.core.config import settings

Username = Annotated[
    str, StringConstraints(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
]
NormalizedEmail = Annotated[EmailStr, StringConstraints(to_lower=True)]


class UserBase(BaseModel):
    username: Username
    email: NormalizedEmail


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserCreateInternal(UserBase):
    hashed_password: str


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool
    is_verified: bool
    telegram_chat_id: int | None
    digest_enabled: bool

    # The ignore is pydantic's documented answer: mypy cannot type a
    # decorator stacked on a property, and computed_field needs exactly that.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_demo(self) -> bool:
        # Derived on every read, never stored: a stored flag would be a second
        # source of truth that disagrees the day the demo address changes.
        return settings.demo.is_demo(self.email)


class LinkedChatUpdate(BaseModel):
    # Positive: private chats only (groups are negative). The ceiling is
    # JavaScript's largest exact integer, not BIGINT's: the browser reads
    # this number back as a double. Telegram promises at most 52 bits.
    chat_id: int = Field(gt=0, le=2**53 - 1)


class PreferencesUpdate(BaseModel):
    # Forbid, not ignore: a body carrying `email` is a client that believes
    # this endpoint changes it, and a silent 200 would confirm the mistake.
    model_config = ConfigDict(extra="forbid")

    digest_enabled: bool


class UserUpdate(BaseModel):
    username: Username | None = None
    email: NormalizedEmail | None = None
