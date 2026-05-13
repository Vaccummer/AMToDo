"""Database infrastructure tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from config import AppSettings
from db.engine import create_database

if TYPE_CHECKING:
    from pathlib import Path


def test_create_database_creates_sqlite_parent(tmp_path: Path) -> None:
    """File-backed SQLite databases create missing parent directories."""

    database_path = tmp_path / "data" / "amtodo.sqlite3"
    settings = AppSettings(database_url=f"sqlite:///{database_path}")

    database = create_database(settings)
    database.create_schema()

    assert database_path.exists()
