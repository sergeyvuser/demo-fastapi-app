"""user is_verified

Revision ID: 56023876f0d2
Revises: d7fda9a8da45
Create Date: 2026-07-22 09:45:20.940547

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "56023876f0d2"
down_revision: str | Sequence[str] | None = "d7fda9a8da45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column("is_verified", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "is_verified")
