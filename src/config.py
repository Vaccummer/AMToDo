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
DEFAULT_MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB
DEFAULT_UPLOAD_TOKEN_TTL_SECONDS = 300  # 5 minutes
DEFAULT_UPLOAD_TEMP_ROOT = str(Path(__import__("tempfile").gettempdir()) / "amtodo-uploads")
DEFAULT_RATE_LIMIT_REQUESTS = 30
DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
DEFAULT_IP_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Runtime settings shared by CLI, UI, and services."""

    database_url: str
    language: str = DEFAULT_LANGUAGE
    timezone: str = DEFAULT_TIMEZONE
    server_url: str = ""
    public_url: str = ""
    access_token: str = ""
    server_host: str | None = "0.0.0.0"
    server_port: int = 8000
    server_name: str = ""
    admin_token: str = ""
    max_attachment_size_bytes: int = DEFAULT_MAX_ATTACHMENT_SIZE_BYTES
    attachment_root: str = ""
    rate_limit_requests: int = DEFAULT_RATE_LIMIT_REQUESTS
    rate_limit_window_seconds: int = DEFAULT_RATE_LIMIT_WINDOW_SECONDS
    ip_cache_ttl_seconds: int = DEFAULT_IP_CACHE_TTL_SECONDS
    trusted_proxy_ips: tuple[str, ...] = ()
    cors_allow_origins: tuple[str, ...] = ("*",)
    security_headers_enabled: bool = True
    hsts_enabled: bool = False
    hsts_max_age_seconds: int = 15_552_000


def amtodo_home() -> Path:
    """Return the AMToDo runtime home directory."""

    raw = os.environ.get("AMTODO_HOME")
    return Path(raw).expanduser() if raw else Path.home() / ".amtodo"


def _component_root(component: str) -> Path:
    return amtodo_home() / component


def server_root() -> Path:
    """Return the server runtime root directory."""

    return _component_root("server")


def cli_root() -> Path:
    """Return the CLI runtime root directory."""

    return _component_root("cli")


def ui_root() -> Path:
    """Return the UI runtime root directory."""

    return _component_root("ui")


def _default_database_url(root: Path) -> str:
    """Return the default SQLite database URL under the given root."""

    return f"sqlite:///{root / 'db' / 'amtodo.sqlite3'}"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_settings() -> AppSettings:
    """Load settings from environment variables (used by server / UI)."""

    root = server_root()
    return AppSettings(
        database_url=os.environ.get("AMTODO_DATABASE_URL", _default_database_url(root)),
        language=os.environ.get("AMTODO_LANGUAGE", DEFAULT_LANGUAGE),
        timezone=os.environ.get("AMTODO_TIMEZONE", DEFAULT_TIMEZONE),
        server_url=os.environ.get("AMTODO_SERVER_URL", ""),
        access_token=os.environ.get("AMTODO_SERVER_TOKEN", ""),
        max_attachment_size_bytes=_int_env(
            "AMTODO_MAX_ATTACHMENT_SIZE_BYTES", DEFAULT_MAX_ATTACHMENT_SIZE_BYTES
        ),
    )


def load_cli_settings() -> AppSettings:
    """Load CLI settings from $AMTODO_HOME/cli/config.toml.

    ``server_url`` is required — local-only mode is no longer supported.
    """

    import json as _json

    root = cli_root()
    config_path = root / "config.toml"

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

    if not server_url:
        print(
            _json.dumps(
                {"ok": False, "error": "server_url is not set in cli/config.toml; local mode is disabled"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    return AppSettings(
        database_url=database_url,
        server_url=server_url,
        access_token=access_token,
        admin_token=admin_token,
    )


def load_ui_settings() -> AppSettings:
    """Load UI settings from $AMTODO_HOME/ui/config.toml."""

    root = ui_root()
    config_path = root / "config.toml"

    server_url = ""
    access_token = ""
    admin_token = ""

    if config_path.is_file():
        data = tomllib.loads(config_path.read_text(encoding="utf-8"))
        server_url = data.get("server_url", "")
        access_token = data.get("access_token", "")
        admin_token = data.get("admin_token", "")

    return AppSettings(
        database_url="",
        server_url=server_url,
        access_token=access_token,
        admin_token=admin_token,
    )
