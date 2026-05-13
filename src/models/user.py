"""User model (stored in the main database)."""

from __future__ import annotations

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class User(Base):
    """A user with their own access token."""

    __tablename__ = "_users"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
