"""user digest switch

Revision ID: f29becfd6064
Revises: 8d82f2bb6819
Create Date: 2026-10-23 17:15:00.075849

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f29becfd6064"
down_revision: str | Sequence[str] | None = "8d82f2bb6819"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column(
            "digest_enabled", sa.Boolean(), server_default="false", nullable=False
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "digest_enabled")
