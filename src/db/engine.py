"""Database engine and session management."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from db.base import Base
from models import register_models

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

    from config import AppSettings


@dataclass(frozen=True, slots=True)
class Database:
    """Owns the SQLAlchemy engine and creates sessions."""

    engine: Engine
    session_factory: sessionmaker[Session]

    def create_schema(self) -> None:
        """Create all registered database tables."""

        register_models()
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """Open a session and close it when the caller is done."""

        session = self.session_factory()
        try:
            yield session
        finally:
            session.close()


def create_database(settings: AppSettings) -> Database:
    """Create the database adapter from application settings."""

    return create_database_from_url(settings.database_url)


def create_database_from_url(database_url: str) -> Database:
    """Create the database adapter from a URL string."""

    ensure_sqlite_parent(database_url)
    connect_args: dict[str, object] = {"check_same_thread": False} if _is_sqlite(database_url) else {}
    engine = create_engine(database_url, future=True, connect_args=connect_args)
    return Database(engine=engine, session_factory=sessionmaker(engine, expire_on_commit=False))


def ensure_sqlite_parent(database_url: str) -> None:
    """Create the parent directory for file-backed SQLite databases."""

    url = make_url(database_url)
    if (
        url.drivername not in {"sqlite", "sqlite+pysqlite"}
        or url.database in {None, "", ":memory:"}
    ):
        return

    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


def _is_sqlite(database_url: str) -> bool:
    """Return True if the database URL targets SQLite."""
    url = make_url(database_url)
    return url.drivername in {"sqlite", "sqlite+pysqlite"}
