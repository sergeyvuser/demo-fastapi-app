"""alert expiry

Revision ID: 254ed1f64184
Revises: 487cf07c5d4c
Create Date: 2026-10-02 13:01:50.200794

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "254ed1f64184"
down_revision: str | Sequence[str] | None = "487cf07c5d4c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable with no default: NULL is "no Expiry", which is what every
    # existing row already is — no UPDATE. `status` needs no DDL for the new
    # `expired` value: it is a VARCHAR(20) with no CHECK.
    op.add_column(
        "alerts", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    # The previous code's enum has no `expired`, and would fail to read such
    # a row. `completed` is the nearest Finished status it knows: the Alert
    # stays out of service, it only loses the reason. Lossy, on purpose.
    op.execute("UPDATE alerts SET status = 'completed' WHERE status = 'expired'")
    op.drop_column("alerts", "expires_at")
