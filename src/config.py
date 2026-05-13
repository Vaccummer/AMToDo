"""Application configuration primitives."""

from __future__ import annotations

import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

__version__ = "0.1.0"

DEFAULT_LANGUAGE = "zh-CN"
DEFAULT_TIMEZONE = "Asia/Shanghai"
DEFAULT_SERVER_URL = "http://127.0.0.1:8000"


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Runtime settings shared by CLI, UI, and services."""

    database_url: str
    language: str = DEFAULT_LANGUAGE
    timezone: str = DEFAULT_TIMEZONE
    server_url: str = ""
    access_token: str = ""
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    admin_token: str = ""


def amtodo_root() -> Path:
    """Return the AMTODO_ROOT directory.

    Requires the AMTODO_ROOT environment variable to be set to an existing
    directory.  Exits with an error message if the variable is missing or the
    path is invalid.
    """

    raw = os.environ.get("AMTODO_ROOT")
    if not raw:
        print("FATAL: AMTODO_ROOT environment variable is not set", file=sys.stderr)
        sys.exit(1)

    root = Path(raw)
    if not root.is_dir():
        print(f"FATAL: AMTODO_ROOT is not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    return root


def _default_database_url(root: Path) -> str:
    """Return the default SQLite database URL under the given root."""

    return f"sqlite:///{root / 'db' / 'amtodo.sqlite3'}"


def load_settings() -> AppSettings:
    """Load settings from environment variables (used by server / UI)."""

    root = amtodo_root()
    return AppSettings(
        database_url=os.environ.get("AMTODO_DATABASE_URL", _default_database_url(root)),
        language=os.environ.get("AMTODO_LANGUAGE", DEFAULT_LANGUAGE),
        timezone=os.environ.get("AMTODO_TIMEZONE", DEFAULT_TIMEZONE),
        server_url=os.environ.get("AMTODO_SERVER_URL", ""),
        access_token=os.environ.get("AMTODO_SERVER_TOKEN", ""),
    )


def load_cli_settings() -> AppSettings:
    """Load CLI settings from $AMTODO_ROOT/config/cli.toml.

    database_url in cli.toml takes priority over server_url.  When neither
    is set a local SQLite database under AMTODO_ROOT is used.
    """

    root = amtodo_root()
    config_path = root / "config" / "cli.toml"

    database_url = ""
    server_url = ""
    access_token = ""
    admin_token = ""

    if config_path.is_file():
        data = tomllib.loads(config_path.read_text(encoding="utf-8"))
        database_url = data.get("database_url", "")
        server_url = data.get("server_url", "")
        access_token = data.get("access_token", "")
        admin_token = data.get("admin_token", "")

    if not database_url and not server_url:
        database_url = _default_database_url(root)

    return AppSettings(
        database_url=database_url,
        server_url=server_url,
        access_token=access_token,
        admin_token=admin_token,
    )
