"""Application setting persistence model."""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class Setting(Base):
    """A persisted key-value setting.

    This is an abstract base — concrete subclasses must supply ``__tablename__``
    via :func:`models.factory.get_standalone_tables` or
    :func:`models.factory.get_user_tables`.
    """

    __abstract__ = True

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
