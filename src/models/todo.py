"""ToDo persistence model."""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class Todo(EpochAuditMixin, Base):
    """A task stored with separate planning and due timestamps.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    and ``__table_args__`` via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    planned_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    due_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tag: Mapped[str | None] = mapped_column(String(80), nullable=True)
    completed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deleted_at: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
