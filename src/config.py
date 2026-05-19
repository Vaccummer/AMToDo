"""Application configuration primitives."""

from __future__ import annotations

import os
import sys
import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

__version__ = "0.1.0"

DEFAULT_LANGUAGE = "zh-CN"
DEFAULT_TIMEZONE = "Asia/Shanghai"
DEFAULT_SERVER_URL = "http://127.0.0.1:8000"
DEFAULT_MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB
DEFAULT_MAX_ATTACHMENT_REQUEST_BODY_BYTES = int(DEFAULT_MAX_ATTACHMENT_SIZE_BYTES * 1.5)
DEFAULT_MAX_ATTACHMENTS_PER_TODO = 20
DEFAULT_RATE_LIMIT_REQUESTS = 30
DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60
DEFAULT_IP_CACHE_TTL_SECONDS = 300
_AMTODO_SERVER_ROOT_CACHE = Path()
_AMTODO_CLI_ROOT_CACHE = Path()


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Runtime settings shared by CLI, UI, and services."""

    database_url: str
    language: str = DEFAULT_LANGUAGE
    timezone: str = DEFAULT_TIMEZONE
    server_url: str = ""
    access_token: str = ""
    server_host: str | None = "0.0.0.0"
    server_port: int = 8000
    admin_token: str = ""
    server_public_key_path: str = ""
    server_private_key_path: str = ""
    request_timestamp_tolerance_seconds: int = 300
    max_attachment_size_bytes: int = DEFAULT_MAX_ATTACHMENT_SIZE_BYTES
    max_attachment_request_body_bytes: int = DEFAULT_MAX_ATTACHMENT_REQUEST_BODY_BYTES
    max_attachments_per_todo: int = DEFAULT_MAX_ATTACHMENTS_PER_TODO
    attachment_root: str = ""
    rate_limit_requests: int = DEFAULT_RATE_LIMIT_REQUESTS
    rate_limit_window_seconds: int = DEFAULT_RATE_LIMIT_WINDOW_SECONDS
    ip_cache_ttl_seconds: int = DEFAULT_IP_CACHE_TTL_SECONDS


def _resolve_root(
    env_var: str,
    cache_attr: str,
    *,
    fatal_handler: Callable[[str], None] | None = None,
) -> Path:
    """Resolve a root directory from an environment variable with caching.

    *fatal_handler* is called with an error message instead of the default
    stderr print + sys.exit(1) when provided.
    """
    cache: Path = globals()[cache_attr]
    _die = fatal_handler or (lambda msg: (print(f"FATAL: {msg}", file=sys.stderr), sys.exit(1)))

    raw = os.environ.get(env_var)
    if not raw:
        if cache:
            return cache
        _die(f"{env_var} environment variable is not set")
        sys.exit(1)  # unreachable if handler exits, keeps type-checker happy

    root = Path(raw)
    if cache == root:
        return cache
    if not root.is_dir():
        _die(f"{env_var} is not a directory: {root}")
        sys.exit(1)
    globals()[cache_attr] = root
    return root


def server_root() -> Path:
    """Return the server root directory from AMTODO_SERVER_ROOT."""
    return _resolve_root("AMTODO_SERVER_ROOT", "_AMTODO_SERVER_ROOT_CACHE")


def cli_root() -> Path:
    """Return the CLI root directory from AMTODO_CLI_ROOT."""
    import json as _json

    def _json_fatal(msg: str) -> None:
        print(_json.dumps({"ok": False, "error": msg}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    return _resolve_root("AMTODO_CLI_ROOT", "_AMTODO_CLI_ROOT_CACHE", fatal_handler=_json_fatal)



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
        max_attachment_request_body_bytes=_int_env(
            "AMTODO_MAX_ATTACHMENT_REQUEST_BODY_BYTES",
            DEFAULT_MAX_ATTACHMENT_REQUEST_BODY_BYTES,
        ),
        max_attachments_per_todo=_int_env(
            "AMTODO_MAX_ATTACHMENTS_PER_TODO", DEFAULT_MAX_ATTACHMENTS_PER_TODO
        ),
    )


def load_cli_settings() -> AppSettings:
    """Load CLI settings from $AMTODO_CLI_ROOT/config/cli.toml.

    ``server_url`` is required — local-only mode is no longer supported.
    """

    import json as _json

    root = cli_root()
    config_path = root / "config" / "cli.toml"

    database_url = ""
    server_url = ""
    access_token = ""
    admin_token = ""
    server_public_key_path = ""

    if config_path.is_file():
        data = tomllib.loads(config_path.read_text(encoding="utf-8"))
        database_url = data.get("database_url", "")
        server_url = data.get("server_url", "")
        access_token = data.get("access_token", "")
        admin_token = data.get("admin_token", "")
        server_public_key_path = data.get("server_public_key_path", "")

    if not server_url:
        print(
            _json.dumps(
                {"ok": False, "error": "server_url is not set in cli.toml; local mode is disabled"},
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
        server_public_key_path=server_public_key_path,
    )


def load_ui_settings() -> AppSettings:
    """Load UI settings from $AMTODO_SERVER_ROOT/config/ui.toml."""

    root = server_root()
    config_path = root / "config" / "ui.toml"

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
