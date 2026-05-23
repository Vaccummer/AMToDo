"""Notification persistence model."""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class Notification(EpochAuditMixin, Base):
    """A one-shot notification with a trigger time.

    Abstract base -- concrete subclasses supply ``__tablename__`` and
    ``__table_args__`` via the factory.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    trigger_at: Mapped[int] = mapped_column(Integer, nullable=False)
    deleted_at: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    extra_fields: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
