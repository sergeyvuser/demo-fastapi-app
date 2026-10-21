"""user linked chat unique

Revision ID: 8d82f2bb6819
Revises: 123787a41a5b
Create Date: 2026-10-21 17:55:46.186626

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8d82f2bb6819"
down_revision: str | Sequence[str] | None = "123787a41a5b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Fails if two rows already share a chat id — nothing writes the column
    # through the API before this revision, so only a hand edit could.
    op.create_unique_constraint(
        op.f("uq_users_telegram_chat_id"), "users", ["telegram_chat_id"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("uq_users_telegram_chat_id"), "users", type_="unique")
