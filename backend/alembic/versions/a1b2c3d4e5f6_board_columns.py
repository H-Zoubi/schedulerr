"""Per-board columns: tasks point at a column instead of a fixed status.

Revision ID: a1b2c3d4e5f6
Revises: 6892f0f92db6
Create Date: 2026-10-04
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "6892f0f92db6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (key, name, is_done) for the default columns every board starts with.
DEFAULT_COLUMNS = [
    ("inbox", "Inbox", False),
    ("planned", "Planned", False),
    ("doing", "Doing", False),
    ("done", "Done", True),
]


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "columns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key", sa.String(20), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_done", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # Default columns: one set for the general board, one set per existing project.
    scopes: list[int | None] = [None] + [
        row[0] for row in bind.execute(sa.text("SELECT id FROM projects")).fetchall()
    ]
    column_ids: dict[tuple[int | None, str], int] = {}
    for project_id in scopes:
        for position, (key, name, is_done) in enumerate(DEFAULT_COLUMNS):
            bind.execute(
                sa.text(
                    "INSERT INTO columns (project_id, name, key, position, is_done) "
                    "VALUES (:p, :n, :k, :pos, :d)"
                ),
                {"p": project_id, "n": name, "k": key, "pos": position, "d": is_done},
            )
            if project_id is None:
                lookup = sa.text("SELECT id FROM columns WHERE project_id IS NULL AND key = :k")
                params = {"k": key}
            else:
                lookup = sa.text("SELECT id FROM columns WHERE project_id = :p AND key = :k")
                params = {"p": project_id, "k": key}
            new_id = bind.execute(lookup, params).scalar_one()
            column_ids[(project_id, key)] = new_id

    # Tasks get a column_id, chosen from their old status within their own project.
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("column_id", sa.Integer(), nullable=True))

    tasks = bind.execute(sa.text("SELECT id, project_id, status FROM tasks")).fetchall()
    for task_id, project_id, status in tasks:
        column_id = column_ids.get((project_id, status or "inbox"), column_ids[(project_id, "inbox")])
        bind.execute(
            sa.text("UPDATE tasks SET column_id = :c WHERE id = :t"),
            {"c": column_id, "t": task_id},
        )

    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("status")
        batch.create_foreign_key(
            "fk_tasks_column_id", "columns", ["column_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    raise NotImplementedError("Downgrading the board columns migration is not supported.")
