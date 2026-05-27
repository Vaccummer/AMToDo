"""FastAPI application for AMToDo server."""

from __future__ import annotations

import logging
import logging.config
import sys
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import select

import json

from config import DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS, DEFAULT_IP_CACHE_TTL_SECONDS, DEFAULT_MAX_ATTACHMENT_SIZE_BYTES, DEFAULT_RATE_LIMIT_REQUESTS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_UPLOAD_TEMP_ROOT, DEFAULT_UPLOAD_TOKEN_TTL_SECONDS, __version__, AppSettings, server_root
from amtodo_crypto import ReplayProtector, is_envelope, open_envelope_with_key, seal_response
from exceptions import AMToDoError, ConflictError, NotFoundError, ValidationError
from models.user import User
from serialization import error_to_dict
from server.admin import router as admin_router
from server.attachment_routes import router as attachment_router
from server.notifications import router as notification_router
from server.proxy import ForwardedHeadersMiddleware, SecurityHeadersMiddleware
from server.notification_ws import router as ws_router
from server.rate_limit import RateLimitMiddleware, RateLimiter
from server.schedules import router as schedule_router
from server.todos import router as todo_router
from server.trash import router as trash_router
from server.ui_ws import router as ui_ws_router


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
    import asyncio as _asyncio

    from db.engine import Database, create_database
    from server.websocket_manager import (
        NotificationResultCache,
        SessionKeyManager,
        WebSocketManager,
    )

    settings: AppSettings = app.state.settings
    db: Database = create_database(settings)

    try:
        db.create_schema()
        token_map = _build_token_map(db)
        _register_per_user_tables(db, token_map)
        if token_map:
            db.create_schema()
            db.ensure_per_user_todo_indexes()
    except Exception as exc:
        print(f"FATAL: startup failed: {exc}", file=sys.stderr)
        raise

    app.state.db = db
    app.state.token_map = token_map

    # --- WebSocket notification push ----------------------------------
    notif_cfg = getattr(app.state, "notification_config", {})
    session_key_ttl = int(notif_cfg.get("session_key_ttl", 3600))

    key_mgr = SessionKeyManager(ttl_seconds=session_key_ttl)
    ws_mgr = WebSocketManager()
    app.state.ws_key_manager = key_mgr
    app.state.ws_manager = ws_mgr

    # Start background tasks
    _bg_tasks: list[_asyncio.Task] = []

    async def _watcher_wrapper():
        """Thin wrapper that passes the notification config to the watcher."""
        from server.notification_ws import _notification_watcher

        await _notification_watcher(ws_mgr, key_mgr, db, token_map, notif_cfg)

    async def _heartbeat_wrapper():
        """Thin wrapper that passes the notification config to the heartbeat task."""
        from server.notification_ws import _heartbeat_task

        await _heartbeat_task(ws_mgr, notif_cfg)

    _bg_logger = logging.getLogger("amtodo")

    def _log_task_exception(task: _asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            _bg_logger.error("Background task %s failed: %s", task.get_name(), exc, exc_info=exc)

    t1 = _asyncio.create_task(_watcher_wrapper(), name="notification-watcher")
    t1.add_done_callback(_log_task_exception)
    _bg_tasks.append(t1)

    t2 = _asyncio.create_task(_heartbeat_wrapper(), name="ws-heartbeat")
    t2.add_done_callback(_log_task_exception)
    _bg_tasks.append(t2)

    yield

    # Shutdown: cancel background tasks and dispose engine
    for t in _bg_tasks:
        t.cancel()
    db.engine.dispose()



def _build_replay_protector(settings: AppSettings) -> ReplayProtector:
    return ReplayProtector(tolerance_seconds=settings.request_timestamp_tolerance_seconds)


def _load_private_keys(settings: AppSettings) -> dict[str, bytes]:
    """Load the P-256 private key, validate it, return key_id → PEM bytes."""
    root = server_root()
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
    from amtodo_crypto.keys import load_private_key
    from cryptography.hazmat.primitives.asymmetric import ec

    private_keys = _load_private_keys(settings)
    parsed_keys: dict[str, ec.EllipticCurvePrivateKey] = {}
    for key_id, pem in private_keys.items():
        parsed_keys[key_id] = load_private_key(pem)

    # Store the primary parsed private key for UI WebSocket auth handshake
    if parsed_keys:
        app.state.encryption_private_key = next(iter(parsed_keys.values()))

    @app.middleware("http")
    async def decryption_middleware(request, call_next):
        from starlette.requests import Request

        # Health check passes through unencrypted
        if request.url.path.rstrip("/") == "/api/v1/health":
            return await call_next(request)

        # Read-only methods pass through without body encryption
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        # Streaming upload passes through unencrypted (token-authenticated)
        if request.method == "PUT" and request.url.path.rstrip("/").endswith("/attachment/upload"):
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

        key_id = body_json.get("keyId")
        parsed_key = parsed_keys.get(key_id) if key_id else None
        if parsed_key is None:
            return JSONResponse(
                status_code=400,
                content=error_to_dict(ValidationError, f"unknown or missing keyId: {key_id!r}"),
            )

        try:
            inner, data_key = open_envelope_with_key(body_json, parsed_key)
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

        # Encrypt all JSON responses with the session data key
        if _is_json_response(response):
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


def _setup_rate_limit_middleware(app: FastAPI, settings: AppSettings) -> None:
    """Add per-IP rate limiting middleware for public (unauthenticated) endpoints."""
    limiter = RateLimiter(
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    public_paths = frozenset({
        "/api/v1/health",
        "/api/v1/agent-guide",
    })
    app.add_middleware(RateLimitMiddleware, limiter=limiter, public_paths=public_paths)


def _as_str_tuple(value: object, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    if value is None:
        return default
    if isinstance(value, str):
        return tuple(part.strip() for part in value.split(",") if part.strip())
    if isinstance(value, list | tuple):
        return tuple(str(part).strip() for part in value if str(part).strip())
    return default


def _as_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def create_app(settings: AppSettings) -> FastAPI:
    """Build the FastAPI application."""
    app = FastAPI(
        title="AMToDo API",
        version=__version__,
        lifespan=lifespan,
    )

    if settings.security_headers_enabled:
        app.add_middleware(
            SecurityHeadersMiddleware,
            hsts_enabled=settings.hsts_enabled,
            hsts_max_age_seconds=settings.hsts_max_age_seconds,
        )

    # Allow configured cross-origin requests from desktop/mobile shells.
    from starlette.middleware.cors import CORSMiddleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allow_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.settings = settings
    app.state.replay_protector = _build_replay_protector(settings)

    resolved_attachment_root = server_root() / settings.attachment_root
    resolved_attachment_root.mkdir(parents=True, exist_ok=True)
    app.state.attachment_root = resolved_attachment_root

    # Upload/download token stores for streaming attachment transfer
    from services.upload_tokens import DownloadTokenStore, UploadTokenStore

    temp_root = Path(DEFAULT_UPLOAD_TEMP_ROOT)
    temp_root.mkdir(parents=True, exist_ok=True)
    app.state.upload_token_store = UploadTokenStore(
        temp_root=temp_root,
        ttl_seconds=DEFAULT_UPLOAD_TOKEN_TTL_SECONDS,
    )
    app.state.download_token_store = DownloadTokenStore(
        ttl_seconds=DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
    )

    if settings.server_private_key_path:
        _setup_encryption_middleware(app, settings)

    if settings.rate_limit_requests > 0:
        _setup_rate_limit_middleware(app, settings)

    if settings.trusted_proxy_ips:
        app.add_middleware(
            ForwardedHeadersMiddleware,
            trusted_proxy_ips=settings.trusted_proxy_ips,
        )

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

    app.include_router(attachment_router, prefix="/api/v1")
    app.include_router(todo_router, prefix="/api/v1/todos", tags=["todos"])
    app.include_router(schedule_router, prefix="/api/v1/schedules", tags=["schedules"])
    app.include_router(notification_router, prefix="/api/v1/notifications", tags=["notifications"])
    app.include_router(trash_router, prefix="/api/v1")
    app.include_router(ws_router, prefix="/api/v1/notifications", tags=["notifications"])
    app.include_router(ui_ws_router, prefix="/api/v1", tags=["ui-ws"])

    return app


def main() -> None:
    """Run the AMToDo HTTP/2-capable server."""
    import asyncio

    from hypercorn.asyncio import serve
    from hypercorn.config import Config

    root = server_root()
    raw = _load_raw_config(str(root / "config" / "server.toml"))

    server = raw.get("server", {})
    database_cfg = raw.get("database", {})
    auth = raw.get("auth", {})
    log_cfg = raw.get("log", {})
    storage_cfg = raw.get("storage", {})
    encryption_cfg = raw.get("encryption", {})
    rate_limit_cfg = raw.get("rate_limit", {})
    health_cfg = raw.get("health", {})
    proxy_cfg = raw.get("proxy", {})
    cors_cfg = raw.get("cors", {})
    security_headers_cfg = raw.get("security_headers", {})

    log_file = log_cfg.get("file", "log/server.log")
    database_url = database_cfg.get("url", "sqlite:///db/amtodo.sqlite3")
    host = server.get("host", "")
    if not host or host == "null":
        host = None
    port = server.get("port", 8000)
    server_name = server.get("name", "")
    public_url = server.get("public_url", "")
    admin_token = auth.get("admin_token", "")
    attachment_root = storage_cfg.get("attachment_root", "")
    max_attachment_size_bytes = storage_cfg.get(
        "max_attachment_size_bytes", DEFAULT_MAX_ATTACHMENT_SIZE_BYTES
    )
    private_key_path = encryption_cfg.get("private_key_path", "")
    public_key_path = encryption_cfg.get("public_key_path", "")
    tolerance = encryption_cfg.get("request_timestamp_tolerance_seconds", 300)
    rate_limit_requests = rate_limit_cfg.get("requests", DEFAULT_RATE_LIMIT_REQUESTS)
    rate_limit_window_seconds = rate_limit_cfg.get("window_seconds", DEFAULT_RATE_LIMIT_WINDOW_SECONDS)
    ip_cache_ttl = health_cfg.get("ip_cache_ttl", DEFAULT_IP_CACHE_TTL_SECONDS)
    trusted_proxy_ips = _as_str_tuple(proxy_cfg.get("trusted_ips"))
    cors_allow_origins = _as_str_tuple(cors_cfg.get("allow_origins"), ("*",))
    security_headers_enabled = _as_bool(security_headers_cfg.get("enabled"), True)
    hsts_enabled = _as_bool(security_headers_cfg.get("hsts_enabled"), False)
    hsts_max_age_seconds = int(security_headers_cfg.get("hsts_max_age_seconds", 15_552_000))

    if not admin_token:
        print("FATAL: admin_token is not configured in config/server.toml", file=sys.stderr)
        sys.exit(1)

    if not attachment_root:
        print("FATAL: attachment_root is not configured in config/server.toml", file=sys.stderr)
        sys.exit(1)

    log_path = (root / log_file).resolve()

    print(f"AMToDo Server v{__version__}")
    print(f"  Log:       {log_path}")
    print(f"  Database:  {database_url}")
    listen_display = f"[::]:{port} (dual-stack)" if host is None else f"{host}:{port}"
    print(f"  Listen:    {listen_display}")
    if public_url:
        print(f"  Public URL: {public_url}")
    if trusted_proxy_ips:
        print(f"  Trusted proxies: {', '.join(trusted_proxy_ips)}")
    print(f"  Auth:      admin token configured ({'*' * min(len(admin_token), 8)})")
    print(
        f"  Rate limit: {rate_limit_requests} req / "
        f"{rate_limit_window_seconds}s per IP (public endpoints)"
    )

    settings = AppSettings(
        database_url=database_url,
        admin_token=admin_token,
        server_host=host,
        server_port=port,
        server_name=server_name,
        public_url=public_url,
        server_private_key_path=private_key_path,
        server_public_key_path=public_key_path,
        request_timestamp_tolerance_seconds=tolerance,
        attachment_root=attachment_root,
        max_attachment_size_bytes=max_attachment_size_bytes,
        rate_limit_requests=rate_limit_requests,
        rate_limit_window_seconds=rate_limit_window_seconds,
        ip_cache_ttl_seconds=ip_cache_ttl,
        trusted_proxy_ips=trusted_proxy_ips,
        cors_allow_origins=cors_allow_origins,
        security_headers_enabled=security_headers_enabled,
        hsts_enabled=hsts_enabled,
        hsts_max_age_seconds=hsts_max_age_seconds,
    )
    app = create_app(settings)

    # Store notification config for WebSocket background tasks
    app.state.notification_config = raw.get("notification", {})

    log_config = _build_log_config(str(log_path))
    hypercorn_config = Config()
    hypercorn_config.bind = [f"{'::' if host is None else host}:{port}"]
    hypercorn_config.logconfig_dict = log_config
    hypercorn_config.alpn_protocols = ["h2", "http/1.1"]
    hypercorn_config.accesslog = logging.getLogger("uvicorn.access")
    hypercorn_config.errorlog = logging.getLogger("uvicorn.error")

    try:
        asyncio.run(serve(app, hypercorn_config))
    except Exception:
        logging.getLogger("amtodo").critical("Server failed to start", exc_info=True)
        print("FATAL: Server failed to start", file=sys.stderr)
        raise
