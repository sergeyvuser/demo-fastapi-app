from datetime import datetime

from sqlalchemy import BigInteger, ColumnElement, DateTime, String, and_
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
    # Opt-in: nobody is mailed who has not asked, and the server default
    # covers the rows that existed before the column did.
    digest_enabled: Mapped[bool] = mapped_column(default=False, server_default="false")

    # The Linked chat. UNIQUE: one conversation cannot receive two accounts'
    # Notifications, and a reader could not tell which account a message is for.
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    # The User's token epoch: an access token issued before this instant is
    # refused, which is what makes a logout revoke the access tokens already
    # out there. NULL means the User never signed out — nothing is revoked.
    # Compared against `iat` in `security.revoked_by_epoch`, nowhere else.
    tokens_valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, username={self.username!r})"


def receives_digest() -> ColumnElement[bool]:
    """The Users the Digest is sent to: those who asked for it, while their
    account is active.

    One clause for both of the Digest's selects, so the Triggers and the
    Finished Alerts cannot disagree about who is mailed.
    """
    return and_(User.digest_enabled.is_(True), User.is_active.is_(True))
