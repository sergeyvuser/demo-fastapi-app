"""user token epoch

Revision ID: 123787a41a5b
Revises: 254ed1f64184
Create Date: 2026-10-03 19:36:26.891014

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "123787a41a5b"
down_revision: str | Sequence[str] | None = "254ed1f64184"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column("tokens_valid_from", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "tokens_valid_from")
