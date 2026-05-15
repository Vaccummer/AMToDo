"""FastAPI application for AMToDo server."""

from __future__ import annotations

import logging
import logging.config
import sys
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import select

import json

from config import __version__, AppSettings, amtodo_root
from amtodo_crypto import ReplayProtector, is_envelope, open_envelope, seal_response
from exceptions import AMToDoError, ConflictError, NotFoundError, ValidationError
from models.user import User
from serialization import error_to_dict
from server.admin import router as admin_router
from server.schedules import router as schedule_router
from server.todos import router as todo_router
from server.users import router as users_router

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _load_raw_config(path: str) -> dict:
    """Load the TOML configuration file."""
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"config file not found: {config_path}")
    with open(config_path, "rb") as fh:
        return tomllib.load(fh)


def _build_log_config(log_file: str) -> dict:
    """Build a logging config dict: file gets INFO+, terminal gets WARNING+."""
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "file": {
                "format": "%(asctime)s %(levelname)-8s %(name)s %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
            "terminal": {
                "format": "%(levelname)s: %(message)s",
            },
        },
        "handlers": {
            "file": {
                "class": "logging.FileHandler",
                "filename": str(log_path),
                "encoding": "utf-8",
                "formatter": "file",
                "level": "INFO",
            },
            "terminal": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "terminal",
                "level": "WARNING",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["file", "terminal"], "level": "INFO", "propagate": False},
            "uvicorn.error": {"handlers": ["file", "terminal"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["file"], "level": "INFO", "propagate": False},
            "amtodo": {"handlers": ["file", "terminal"], "level": "INFO", "propagate": False},
        },
    }


def _build_token_map(db) -> dict[str, int]:
    """Build token→user_id map from the _users table."""
    from db.engine import Database

    token_map: dict[str, int] = {}
    with db.session() as session:
        for user in session.scalars(select(User)):
            token_map[user.token] = user.id
    return token_map


def _register_per_user_tables(db, token_map: dict[str, int]) -> None:
    """Pre-register per-user ORM classes so create_schema creates all tables."""
    from models.factory import get_user_tables

    for user_id in token_map.values():
        get_user_tables(user_id)


@asynccontextmanager
async def lifespan(app: FastAPI) -> "AsyncIterator[None]":
    """Startup: create single database, populate token map. Shutdown: dispose engine."""
    from db.engine import Database, create_database

    settings: AppSettings = app.state.settings
    db: Database = create_database(settings)
    db.create_schema()

    token_map = _build_token_map(db)
    _register_per_user_tables(db, token_map)
    if token_map:
        db.create_schema()

    app.state.db = db
    app.state.token_map = token_map

    yield

    db.engine.dispose()


def _build_replay_protector(settings: AppSettings) -> ReplayProtector:
    return ReplayProtector(tolerance_seconds=settings.request_timestamp_tolerance_seconds)


def _load_private_keys(settings: AppSettings) -> dict[str, bytes]:
    """Load the P-256 private key, validate it, return key_id → PEM bytes."""
    root = amtodo_root()
    key_path = root / settings.server_private_key_path
    if not key_path.is_file():
        print(f"FATAL: private key not found: {key_path}", file=sys.stderr)
        sys.exit(1)

    pem = key_path.read_bytes()
    try:
        from amtodo_crypto.keys import load_private_key
        from cryptography.hazmat.primitives.asymmetric import ec
        key = load_private_key(pem)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise TypeError("key is not a P-256 private key")
    except Exception as exc:
        print(f"FATAL: invalid private key: {exc}", file=sys.stderr)
        sys.exit(1)

    return {"server-key-v1": pem}


def _setup_encryption_middleware(app: FastAPI, settings: AppSettings) -> None:
    private_keys = _load_private_keys(settings)

    @app.middleware("http")
    async def decryption_middleware(request, call_next):
        from starlette.requests import Request

        # Health check passes through unencrypted
        if request.url.path.rstrip("/") == "/api/v1/health":
            return await call_next(request)

        if _is_attachment_upload(request):
            return await call_next(request)

        # Read-only methods pass through without body encryption
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        content_type = request.headers.get("content-type", "")
        if "application/json" not in content_type:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, "request must be encrypted"),
            )

        body = await request.body()
        if not body:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, "request must be encrypted"),
            )

        try:
            body_json = json.loads(body)
        except json.JSONDecodeError:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, "request body must be valid JSON"),
            )

        if not is_envelope(body_json):
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, "request must be encrypted"),
            )

        try:
            inner, data_key = open_envelope(body_json, private_keys)
        except ValueError as exc:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, str(exc)),
            )

        try:
            app.state.replay_protector.check_and_record(
                inner["requestId"], inner["timestamp"]
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, str(exc)),
            )

        decrypted_body = json.dumps(inner["payload"]).encode("utf-8")

        async def _receive():
            return {"type": "http.request", "body": decrypted_body}

        request._receive = _receive
        request._body = decrypted_body
        request.state.encryption_data_key = data_key

        response = await call_next(request)

        # Encrypt JSON responses with the session data key
        if response.status_code < 500 and _is_json_response(response):
            body_chunks = [chunk async for chunk in response.body_iterator]
            raw_body = b"".join(body_chunks)
            response_body = json.loads(raw_body)
            encrypted = seal_response(response_body, data_key)
            clean_headers = {
                k: v for k, v in response.headers.items()
                if k.lower() not in ("content-length", "transfer-encoding")
            }
            return JSONResponse(
                content=encrypted,
                status_code=response.status_code,
                headers=clean_headers,
            )

        return response


def _is_json_response(response) -> bool:
    content_type = response.headers.get("content-type", "")
    return "application/json" in content_type


def _is_attachment_upload(request) -> bool:
    # Only the multipart upload endpoint (with a numeric todo_id in the path)
    # needs bypass; the JSON upload endpoint is encrypted like other POSTs.
    import re

    return bool(
        request.method == "POST"
        and re.fullmatch(
            r"/api/v1/todos/\d+/attachments/upload", request.url.path
        )
    )


def create_app(settings: AppSettings) -> FastAPI:
    """Build the FastAPI application."""
    app = FastAPI(
        title="AMToDo API",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.replay_protector = _build_replay_protector(settings)

    resolved_attachment_root = amtodo_root() / settings.attachment_root
    resolved_attachment_root.mkdir(parents=True, exist_ok=True)
    app.state.attachment_root = resolved_attachment_root

    if settings.server_private_key_path:
        _setup_encryption_middleware(app, settings)

    @app.exception_handler(ValidationError)
    async def handle_validation(request, exc):
        return JSONResponse(
            status_code=400,
            content=error_to_dict(type(exc), str(exc)),
        )

    @app.exception_handler(NotFoundError)
    async def handle_not_found(request, exc):
        return JSONResponse(
            status_code=404,
            content=error_to_dict(type(exc), str(exc)),
        )

    @app.exception_handler(ConflictError)
    async def handle_conflict(request, exc):
        return JSONResponse(
            status_code=409,
            content=error_to_dict(type(exc), str(exc)),
        )

    @app.exception_handler(AMToDoError)
    async def handle_domain_error(request, exc):
        return JSONResponse(
            status_code=500,
            content=error_to_dict(type(exc), str(exc)),
        )

    app.include_router(admin_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1/admin/users", tags=["admin"])
    app.include_router(todo_router, prefix="/api/v1/todos", tags=["todos"])
    app.include_router(schedule_router, prefix="/api/v1/schedules", tags=["schedules"])

    return app


def main() -> None:
    """Run the AMToDo HTTP server."""
    root = amtodo_root()
    raw = _load_raw_config(str(root / "config" / "server.toml"))

    server = raw.get("server", {})
    database_cfg = raw.get("database", {})
    auth = raw.get("auth", {})
    log_cfg = raw.get("log", {})
    storage_cfg = raw.get("storage", {})
    encryption_cfg = raw.get("encryption", {})

    log_file = log_cfg.get("file", "log/server.log")
    database_url = database_cfg.get("url", "sqlite:///db/amtodo.sqlite3")
    host = server.get("host", "0.0.0.0")
    port = server.get("port", 8000)
    admin_token = auth.get("admin_token", "")
    private_key_path = encryption_cfg.get("private_key_path", "")
    public_key_path = encryption_cfg.get("public_key_path", "")
    tolerance = encryption_cfg.get("request_timestamp_tolerance_seconds", 300)

    if not admin_token:
        print("FATAL: admin_token is not configured in config/server.toml", file=sys.stderr)
        sys.exit(1)

    log_path = (root / log_file).resolve()

    print(f"AMToDo Server v{__version__}")
    print(f"  Log:       {log_path}")
    print(f"  Database:  {database_url}")
    print(f"  Listen:    http://{host}:{port}")
    print(f"  Auth:      admin token configured ({'*' * min(len(admin_token), 8)})")

    attachment_root = storage_cfg.get("attachment_root", "")

    settings = AppSettings(
        database_url=database_url,
        admin_token=admin_token,
        server_host=host,
        server_port=port,
        server_private_key_path=private_key_path,
        server_public_key_path=public_key_path,
        request_timestamp_tolerance_seconds=tolerance,
        attachment_root=attachment_root,
    )
    if not attachment_root:
        print("FATAL: attachment_root is not configured in config/server.toml", file=sys.stderr)
        sys.exit(1)

    app = create_app(settings)

    log_config = _build_log_config(str(log_path))
    try:
        uvicorn.run(app, host=host, port=port, log_config=log_config)
    except Exception:
        logging.getLogger("amtodo").critical("Server failed to start", exc_info=True)
        print("FATAL: Server failed to start", file=sys.stderr)
        raise
