"""Encrypted ToDo attachment persistence model."""

from __future__ import annotations

from sqlalchemy import BigInteger, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, EpochAuditMixin


class TodoAttachment(EpochAuditMixin, Base):
    """A metadata row for an encrypted attachment stored on disk."""

    __abstract__ = True

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    todo_id: Mapped[int] = mapped_column(Integer, nullable=False)
    file_index: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String(260), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    preview_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    plain_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cipher_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    plain_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    cipher_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    file_key: Mapped[str] = mapped_column(String(64), nullable=False)
    nonce: Mapped[str] = mapped_column(String(32), nullable=False)
    encryption_alg: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    is_orphaned: Mapped[bool] = mapped_column(default=False, server_default="0")
