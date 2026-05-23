"""Schedule persistence model."""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class Schedule(EpochAuditMixin, Base):
    """A fixed time-window schedule item stored as Unix epoch seconds.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    and ``__table_args__`` via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[int] = mapped_column(Integer, nullable=False)
    end_at: Mapped[int] = mapped_column(Integer, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    deleted_at: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    extra_fields: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
