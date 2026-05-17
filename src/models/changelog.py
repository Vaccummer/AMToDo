"""Changelog persistence models."""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class TodoChangelog(EpochAuditMixin, Base):
    """Changelog entry for todo modifications.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    and ``__table_args__`` via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    changed_fields: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON


class ScheduleChangelog(EpochAuditMixin, Base):
    """Changelog entry for schedule modifications.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    and ``__table_args__`` via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    changed_fields: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON


class NotificationChangelog(EpochAuditMixin, Base):
    """Changelog entry for notification modifications.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    and ``__table_args__`` via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    changed_fields: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
