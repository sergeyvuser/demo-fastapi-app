"""user telegram_chat_id

Revision ID: d7fda9a8da45
Revises: b5968d3e05c4
Create Date: 2026-07-18 14:15:12.176211

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7fda9a8da45"
down_revision: str | Sequence[str] | None = "b5968d3e05c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users", sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "telegram_chat_id")
