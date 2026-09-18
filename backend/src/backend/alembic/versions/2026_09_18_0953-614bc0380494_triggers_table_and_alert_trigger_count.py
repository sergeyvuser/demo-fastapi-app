"""triggers table and alert trigger count

Revision ID: 614bc0380494
Revises: 56023876f0d2
Create Date: 2026-09-18 09:53:01.288802

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "614bc0380494"
down_revision: str | Sequence[str] | None = "56023876f0d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "triggers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("alert_id", sa.Uuid(), nullable=False),
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
        sa.Column("price", sa.Numeric(precision=20, scale=8), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "delivery",
            sa.Enum(
                "queued",
                "no_chat",
                name="triggerdelivery",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["alert_id"],
            ["alerts.id"],
            name=op.f("fk_triggers_alert_id_alerts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_triggers_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_triggers")),
    )
    op.create_index(
        op.f("ix_triggers_alert_id"), "triggers", ["alert_id"], unique=False
    )
    op.create_index(
        "ix_triggers_user_id_triggered_at_id",
        "triggers",
        ["user_id", "triggered_at", "id"],
        unique=False,
    )
    op.add_column(
        "alerts",
        sa.Column("trigger_count", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("alerts", "trigger_count")
    op.drop_index("ix_triggers_user_id_triggered_at_id", table_name="triggers")
    op.drop_index(op.f("ix_triggers_alert_id"), table_name="triggers")
    op.drop_table("triggers")
