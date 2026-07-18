from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import IdUuidPkMixin, TimestampsMixin


class User(IdUuidPkMixin, TimestampsMixin, Base):
    username: Mapped[str] = mapped_column(String(32), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255))

    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    is_superuser: Mapped[bool] = mapped_column(default=False, server_default="false")

    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger)

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, username={self.username!r})"
