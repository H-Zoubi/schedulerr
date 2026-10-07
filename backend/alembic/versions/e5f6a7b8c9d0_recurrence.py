"""Routine exceptions and intervals, repeating tasks."""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("time_blocks", sa.Column("interval_weeks", sa.Integer(), nullable=False, server_default="1"))
    op.create_table(
        "time_block_exceptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("time_block_id", sa.Integer(), sa.ForeignKey("time_blocks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("on_date", sa.Date(), nullable=False),
        sa.Column("skipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("new_date", sa.Date(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.UniqueConstraint("time_block_id", "on_date", name="uq_time_block_exception"),
    )
    op.add_column("tasks", sa.Column("repeat_every", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("repeat_unit", sa.String(10), nullable=True))


def downgrade():
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("repeat_unit")
        batch.drop_column("repeat_every")
    op.drop_table("time_block_exceptions")
    with op.batch_alter_table("time_blocks") as batch:
        batch.drop_column("interval_weeks")
