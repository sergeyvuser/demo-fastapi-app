"""alert repeat policy and terminal completed status

Revision ID: 487cf07c5d4c
Revises: 614bc0380494
Create Date: 2026-09-24 13:33:55.333736

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "487cf07c5d4c"
down_revision: str | Sequence[str] | None = "614bc0380494"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "alerts",
        sa.Column(
            "repeat_policy",
            sa.Enum(
                "while_true",
                "once",
                "on_cross",
                name="alertrepeatpolicy",
                native_enum=False,
                length=20,
            ),
            server_default="while_true",
            nullable=False,
        ),
    )
    op.add_column(
        "alerts",
        sa.Column(
            "condition_was_met",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "alerts", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.alter_column(
        "alerts",
        "cooldown_seconds",
        existing_type=sa.INTEGER(),
        nullable=True,
        server_default=None,
        existing_server_default=sa.text("3600"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # A downgrade is real code, not a formality: by the time one runs, rows
    # written under `once` or `on_cross` may hold a NULL Cooldown, and
    # restoring NOT NULL over them would fail. Give them back the old default.
    op.execute(
        "UPDATE alerts SET cooldown_seconds = 3600 WHERE cooldown_seconds IS NULL"
    )
    op.alter_column(
        "alerts",
        "cooldown_seconds",
        existing_type=sa.INTEGER(),
        nullable=False,
        server_default=sa.text("3600"),
    )
    op.drop_column("alerts", "finished_at")
    op.drop_column("alerts", "condition_was_met")
    op.drop_column("alerts", "repeat_policy")
