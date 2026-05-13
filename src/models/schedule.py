"""Schedule persistence model."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class Schedule(EpochAuditMixin, Base):
    """A fixed time-window schedule item stored as Unix epoch seconds."""

    __tablename__ = "schedules"
    __table_args__ = (
        CheckConstraint("start_at < end_at", name="ck_schedules_time_window"),
        Index("ix_schedules_time_window", "start_at", "end_at"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[int] = mapped_column(Integer, nullable=False)
    end_at: Mapped[int] = mapped_column(Integer, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
