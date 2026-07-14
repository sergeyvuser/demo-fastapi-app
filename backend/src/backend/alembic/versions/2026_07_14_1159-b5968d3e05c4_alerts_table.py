"""alerts table

Revision ID: b5968d3e05c4
Revises: 43be0d030291
Create Date: 2026-07-14 11:59:27.848042

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5968d3e05c4"
down_revision: Union[str, Sequence[str], None] = "43be0d030291"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column(
            "condition",
            sa.Enum(
                "price_above",
                "price_below",
                name="alertcondition",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("threshold", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "paused",
                "triggered",
                name="alertstatus",
                native_enum=False,
                length=20,
            ),
            server_default="active",
            nullable=False,
        ),
        sa.Column(
            "cooldown_seconds", sa.Integer(), server_default="3600", nullable=False
        ),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_alerts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alerts")),
    )
    op.create_index(
        "ix_alerts_symbol_status", "alerts", ["symbol", "status"], unique=False
    )
    op.create_index(op.f("ix_alerts_user_id"), "alerts", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_alerts_user_id"), table_name="alerts")
    op.drop_index("ix_alerts_symbol_status", table_name="alerts")
    op.drop_table("alerts")
