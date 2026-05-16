"""Initial schema with all tables including planned_at.

Revision ID: 001
Revises: None
Create Date: 2026-05-16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # _users table
    op.create_table(
        "_users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token", sa.String(128), nullable=False, unique=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )

    # Standalone todos table
    op.create_table(
        "todos",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("planned_at", sa.Integer(), nullable=True),
        sa.Column("due_at", sa.Integer(), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("tag", sa.String(80), nullable=True),
        sa.Column("completed_at", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_todos_planned_completed", "todos", ["planned_at", "completed"])
    op.create_index("ix_todos_due_completed", "todos", ["due_at", "completed"])

    # Standalone schedules table
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.Integer(), nullable=False),
        sa.Column("end_at", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("category", sa.String(80), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("start_at < end_at", name="ck_schedules_time_window"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_schedules_time_window", "schedules", ["start_at", "end_at"])

    # Settings table
    op.create_table(
        "settings",
        sa.Column("key", sa.String(200), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )

    # Standalone todo_attachments table
    op.create_table(
        "todo_attachments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("todo_id", sa.Integer(), nullable=False),
        sa.Column("file_index", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(260), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("preview_kind", sa.String(16), nullable=False),
        sa.Column("plain_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("cipher_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("plain_sha256", sa.String(64), nullable=False),
        sa.Column("cipher_sha256", sa.String(64), nullable=False),
        sa.Column("file_key", sa.String(64), nullable=False),
        sa.Column("nonce", sa.String(32), nullable=False),
        sa.Column("encryption_alg", sa.String(32), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("is_orphaned", sa.Boolean(), server_default="0"),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("todo_id", "file_index", name="uq_todo_attachments_todo_file_index"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_todo_attachments_todo", "todo_attachments", ["todo_id"])

    # Standalone schedule_attachments table
    op.create_table(
        "schedule_attachments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        sa.Column("file_index", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(260), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("preview_kind", sa.String(16), nullable=False),
        sa.Column("plain_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("cipher_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("plain_sha256", sa.String(64), nullable=False),
        sa.Column("cipher_sha256", sa.String(64), nullable=False),
        sa.Column("file_key", sa.String(64), nullable=False),
        sa.Column("nonce", sa.String(32), nullable=False),
        sa.Column("encryption_alg", sa.String(32), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("is_orphaned", sa.Boolean(), server_default="0"),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "schedule_id", "file_index", name="uq_schedule_attachments_schedule_file_index"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index(
        "ix_schedule_attachments_schedule", "schedule_attachments", ["schedule_id"]
    )


def downgrade() -> None:
    op.drop_table("schedule_attachments")
    op.drop_table("todo_attachments")
    op.drop_table("settings")
    op.drop_table("schedules")
    op.drop_table("todos")
    op.drop_table("_users")
