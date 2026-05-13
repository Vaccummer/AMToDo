"""ToDo persistence model."""

from __future__ import annotations

from sqlalchemy import Boolean, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class Todo(EpochAuditMixin, Base):
    """A date-scoped task stored with an epoch due boundary."""

    __tablename__ = "todos"
    __table_args__ = (
        Index("ix_todos_due_completed", "due_at", "completed"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tag: Mapped[str | None] = mapped_column(String(80), nullable=True)
    completed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
