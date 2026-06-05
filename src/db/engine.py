"""Database engine and session management."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from db.base import Base
from models import register_models

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

    from config import AppSettings

logger = logging.getLogger("amtodo")


@dataclass(frozen=True, slots=True)
class Database:
    """Owns the SQLAlchemy engine and creates sessions."""

    engine: Engine
    session_factory: sessionmaker[Session]

    def create_schema(self) -> None:
        """Create all registered database tables."""

        register_models()
        Base.metadata.create_all(self.engine)

    def run_migrations(self) -> None:
        """Create the schema using SQLAlchemy metadata."""

        logger.debug("Alembic migrations are disabled; creating schema from metadata")
        self.create_schema()

    def ensure_per_user_todo_indexes(self) -> None:
        """Ensure per-user todo tables have the planned_at column and indexes.

        This handles the case where per-user tables were created by the factory
        before Alembic managed them. For new databases, Alembic handles everything.
        """

        if self.engine.dialect.name != "sqlite":
            return

        inspector = inspect(self.engine)
        todo_tables = {
            table_name
            for table_name in inspector.get_table_names()
            if table_name == "todos" or table_name.startswith("todos_")
        }
        with self.engine.begin() as connection:
            for table_name in sorted(todo_tables):
                columns = {column["name"] for column in inspector.get_columns(table_name)}
                quoted_table = _quote_identifier(table_name)
                if "planned_at" not in columns:
                    connection.execute(
                        text(f"ALTER TABLE {quoted_table} ADD COLUMN planned_at INTEGER")
                    )
                    connection.execute(
                        text(
                            f"UPDATE {quoted_table} "
                            "SET planned_at = created_at WHERE planned_at IS NULL"
                        )
                    )
                quoted_index = _quote_identifier(f"ix_{table_name}_planned_completed")
                connection.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS {quoted_index} "
                        f"ON {quoted_table} (planned_at, completed)"
                    )
                )

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
    connect_args: dict[str, object] = (
        {"check_same_thread": False} if _is_sqlite(database_url) else {}
    )
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


def _quote_identifier(value: str) -> str:
    """Quote an SQLite identifier from SQLAlchemy metadata."""

    return '"' + value.replace('"', '""') + '"'

