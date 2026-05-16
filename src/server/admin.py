"""Admin routes: health check, database initialization, agent guide, and current user."""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from config import __version__, amtodo_root
from db.base import Base
from models.user import User
from serialization import user_to_dict
from server.auth import require_admin, require_user
from server.schemas import AdminConfigRequest, AdminInitDbRequest, UserMeRequest

router = APIRouter()


@router.get("/health")
def health(request: Request) -> dict[str, object]:
    """Return server health status and P-256 public key for request encryption."""
    settings = request.app.state.settings
    result: dict[str, object] = {
        "status": "ok",
        "version": __version__,
        "limits": {
            "max_attachment_size_bytes": settings.max_attachment_size_bytes,
            "max_attachment_request_body_bytes": settings.max_attachment_request_body_bytes,
            "max_attachments_per_todo": settings.max_attachments_per_todo,
        },
    }

    if settings.server_public_key_path:
        try:
            from amtodo_crypto.keys import public_key_spki

            root = amtodo_root()
            pub_path = root / settings.server_public_key_path
            if pub_path.is_file():
                raw = public_key_spki(pub_path.read_bytes())
                result["public_key"] = base64.b64encode(raw).decode("ascii")
        except Exception:
            pass

    return result


@router.get("/agent-guide")
def agent_guide() -> dict[str, object]:
    """Return a machine-oriented description of all API endpoints for AI agents."""
    return {
        "api": "AMToDo",
        "version": __version__,
        "base_url": "http://{host}:{port}/api/v1",
        "auth_methods": {
            "admin": {
                "scheme": "Body",
                "field": "admin_token",
                "applies_to": [
                    "POST /admin/init-db",
                    "POST /admin/config",
                ],
            },
            "user": {
                "scheme": "Body",
                "field": "access_token",
                "note": "User tokens are created via CLI. Business endpoints require a valid user token.",
            },
        },
        "endpoints": [
            {"method": "GET", "path": "/health", "auth": "none"},
            {"method": "GET", "path": "/agent-guide", "auth": "none"},
            {"method": "POST", "path": "/admin/init-db", "auth": "admin", "body": {"admin_token": "<string>"}},
            {"method": "POST", "path": "/admin/config", "auth": "admin", "body": {"admin_token": "<string>"}},
            {"method": "POST", "path": "/user", "auth": "user", "body": {"access_token": "<string>"}},
            {"method": "POST", "path": "/todos/list", "auth": "user"},
            {
                "method": "POST",
                "path": "/todos/search",
                "auth": "user",
                "body": {
                    "query": "<string>",
                    "use_regex": False,
                    "fields": ["title", "description", "tag"],
                    "sort_by": "updated_at",
                    "sort_order": "desc",
                    "limit": 50,
                    "offset": 0,
                },
            },
            {"method": "POST", "path": "/todos/stats", "auth": "user"},
            {"method": "POST", "path": "/todos/create", "auth": "user"},
            {"method": "POST", "path": "/todos/get", "auth": "user"},
            {"method": "POST", "path": "/todos/update", "auth": "user"},
            {"method": "POST", "path": "/todos/done", "auth": "user"},
            {"method": "POST", "path": "/todos/reopen", "auth": "user"},
            {"method": "POST", "path": "/todos/remove", "auth": "user"},
            {"method": "POST", "path": "/todos/batch-create", "auth": "user"},
            {"method": "POST", "path": "/todos/batch-update", "auth": "user"},
            {"method": "POST", "path": "/todos/trash/list", "auth": "user"},
            {"method": "POST", "path": "/todos/trash/restore", "auth": "user"},
            {"method": "POST", "path": "/todos/trash/delete", "auth": "user"},
            {"method": "POST", "path": "/todos/changelog", "auth": "user"},
            {"method": "POST", "path": "/schedules/list", "auth": "user"},
            {
                "method": "POST",
                "path": "/schedules/search",
                "auth": "user",
                "body": {
                    "query": "<string>",
                    "use_regex": False,
                    "fields": ["title", "description", "location", "category"],
                    "sort_by": "updated_at",
                    "sort_order": "desc",
                    "limit": 50,
                    "offset": 0,
                },
            },
            {"method": "POST", "path": "/schedules/stats", "auth": "user"},
            {"method": "POST", "path": "/schedules/conflicts", "auth": "user"},
            {"method": "POST", "path": "/schedules/create", "auth": "user"},
            {"method": "POST", "path": "/schedules/get", "auth": "user"},
            {"method": "POST", "path": "/schedules/update", "auth": "user"},
            {"method": "POST", "path": "/schedules/remove", "auth": "user"},
            {"method": "POST", "path": "/schedules/batch-create", "auth": "user"},
            {"method": "POST", "path": "/schedules/batch-update", "auth": "user"},
            {"method": "POST", "path": "/schedules/trash/list", "auth": "user"},
            {"method": "POST", "path": "/schedules/trash/restore", "auth": "user"},
            {"method": "POST", "path": "/schedules/trash/delete", "auth": "user"},
            {"method": "POST", "path": "/schedules/changelog", "auth": "user"},
        ],
        "conventions": {
            "timestamps": "All timestamps are Unix epoch seconds (int).",
            "auth": "All POST endpoints accept auth via JSON body fields (admin_token or access_token).",
            "errors": "Error responses have shape {detail: <string>} with HTTP 4xx/5xx.",
        },
    }


@router.post("/admin/init-db")
def init_db(
    body: AdminInitDbRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Initialize database schema and stamp Alembic as current."""
    db = request.app.state.db
    Base.metadata.create_all(db.engine)
    db.stamp_head()
    return {"ok": True, "database": "initialized"}


@router.post("/admin/config")
def server_config(
    body: AdminConfigRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Return sensitive server configuration. Requires admin token, fully encrypted."""
    settings = request.app.state.settings
    attachment_root = request.app.state.attachment_root
    return {
        "ok": True,
        "config": {
            "database_url": settings.database_url,
            "attachment_root": str(attachment_root),
        },
    }


@router.post("/user")
def current_user(
    body: UserMeRequest,
    request: Request,
    user_id: int = Depends(require_user),
) -> dict[str, object]:
    """Return the current authenticated user's information."""
    db = request.app.state.db
    with db.session() as session:
        user = session.get(User, user_id)
    return {"ok": True, "user": user_to_dict(user)}
