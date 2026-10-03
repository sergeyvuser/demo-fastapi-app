from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .mixins import IdUuidPkMixin, TimestampsMixin


class User(IdUuidPkMixin, TimestampsMixin, Base):
    username: Mapped[str] = mapped_column(String(32), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255))

    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    is_superuser: Mapped[bool] = mapped_column(default=False, server_default="false")
    is_verified: Mapped[bool] = mapped_column(default=False, server_default="false")

    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger)
    # The User's token epoch: an access token issued before this instant is
    # refused, which is what makes a logout revoke the access tokens already
    # out there. NULL means the User never signed out — nothing is revoked.
    # Compared against `iat` in `security.revoked_by_epoch`, nowhere else.
    tokens_valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, username={self.username!r})"
