"""Spending log."""
from alembic import op
import sqlalchemy as sa

revision = "f1a2b3c4d5e6"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "spendings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(300), nullable=False, server_default=""),
        sa.Column("tag", sa.String(50), nullable=False, server_default=""),
        sa.Column("spent_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("spendings")
