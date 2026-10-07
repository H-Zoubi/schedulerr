"""Event location and notes."""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = "8e51a06c92df"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("events", sa.Column("location", sa.String(300), nullable=False, server_default=""))
    op.add_column("events", sa.Column("notes", sa.Text(), nullable=False, server_default=""))


def downgrade():
    with op.batch_alter_table("events") as batch:
        batch.drop_column("notes")
        batch.drop_column("location")
