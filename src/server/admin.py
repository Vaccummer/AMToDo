"""Admin routes: health check, database initialization, agent guide, and current user."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from config import __version__
from db.base import Base
from models.user import User
from serialization import user_to_dict
from server.auth import require_admin, require_user

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    """Return server health status."""
    return {"status": "ok", "version": __version__}


@router.post("/admin/init-db")
def init_db(
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Initialize database schema."""
    db = request.app.state.db
    Base.metadata.create_all(db.engine)
    return {"ok": True, "database": "initialized"}


@router.get("/user")
def current_user(
    request: Request,
    user_id: int = Depends(require_user),
) -> dict[str, object]:
    """Return the current authenticated user's information."""
    db = request.app.state.db
    with db.session() as session:
        user = session.get(User, user_id)
    return {"ok": True, "user": user_to_dict(user)}


@router.get("/agent-guide")
def agent_guide() -> dict[str, object]:
    """Return a machine-oriented description of all API endpoints for AI agents."""
    return {
        "api": "AMToDo",
        "version": __version__,
        "base_url": "http://{host}:{port}/api/v1",
        "auth_methods": {
            "admin": {
                "scheme": "Bearer",
                "header": "Authorization: Bearer <admin_token>",
                "applies_to": [
                    "POST /admin/init-db",
                    "POST /admin/users",
                    "GET /admin/users",
                    "PATCH /admin/users/{user_id}",
                    "DELETE /admin/users/{user_id}",
                    "PUT /admin/users/{user_id}/token",
                ],
            },
            "user": {
                "scheme": "Bearer",
                "header": "Authorization: Bearer <user_token>",
                "note": "User tokens are created via POST /admin/users and are per-user. Business endpoints require a valid user token.",
            },
        },
        "endpoints": [
            {
                "method": "GET",
                "path": "/health",
                "auth": "none",
                "description": "Health check. Returns server status and version.",
                "query_params": {},
                "body": None,
                "response": {"status": "ok", "version": "<string>"},
            },
            {
                "method": "GET",
                "path": "/agent-guide",
                "auth": "none",
                "description": "Returns this guide — a machine-readable description of all API endpoints.",
                "query_params": {},
                "body": None,
                "response": "<this document>",
            },
            {
                "method": "GET",
                "path": "/user",
                "auth": "user",
                "description": "Return the current authenticated user's information.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "user": {"id": "<int>", "name": "<string>", "token": "<string>", "created_at": "<int>"}},
            },
            {
                "method": "POST",
                "path": "/admin/init-db",
                "auth": "admin",
                "description": "Initialize database schema. Run once before first use.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "database": "initialized"},
            },
            {
                "method": "POST",
                "path": "/admin/users",
                "auth": "admin",
                "description": "Create a new user with a randomly generated access token.",
                "query_params": {},
                "body": {"name": "<string>"},
                "response": {"ok": True, "user": {"id": "<int>", "name": "<string>", "token": "<string>", "created_at": "<int>"}},
            },
            {
                "method": "GET",
                "path": "/admin/users",
                "auth": "admin",
                "description": "List all registered users.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "count": "<int>", "users": "[{id, name, token, created_at}]"},
            },
            {
                "method": "PATCH",
                "path": "/admin/users/{user_id}",
                "auth": "admin",
                "description": "Update a user's name.",
                "query_params": {},
                "body": {"name": "<string>"},
                "response": {"ok": True, "user": {"id": "<int>", "name": "<string>", "token": "<string>", "created_at": "<int>"}},
            },
            {
                "method": "DELETE",
                "path": "/admin/users/{user_id}",
                "auth": "admin",
                "description": "Delete a user by ID.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "deleted": {"id": "<int>", "name": "<string>"}},
            },
            {
                "method": "PUT",
                "path": "/admin/users/{user_id}/token",
                "auth": "admin",
                "description": "Regenerate a user's access token. The old token becomes invalid.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "user": {"id": "<int>", "name": "<string>", "token": "<string>", "created_at": "<int>"}},
            },
            {
                "method": "POST",
                "path": "/todos",
                "auth": "user",
                "description": "Create a ToDo item.",
                "query_params": {},
                "body": {
                    "title": "<string, required>",
                    "due_at": "<int | null, epoch seconds>",
                    "description": "<string | null>",
                    "priority": "<int, default 0, min 0>",
                    "tag": "<string | null>",
                },
                "response": {"ok": True, "todo": "{id, title, due_at, description, priority, tag, completed, created_at, updated_at}"},
            },
            {
                "method": "GET",
                "path": "/todos",
                "auth": "user",
                "description": "List ToDos. Optionally filter by time range and completion status.",
                "query_params": {
                    "start_at": "<int | null, epoch seconds, filter by due_at >= this>",
                    "end_at": "<int | null, epoch seconds, filter by due_at <= this>",
                    "open_only": "<bool, default false, show only incomplete>",
                    "completed_only": "<bool, default false, show only completed>",
                },
                "body": None,
                "response": {"ok": True, "filter": {"completed": "<bool | null>"}, "count": "<int>", "todos": "[...]"},
            },
            {
                "method": "GET",
                "path": "/todos/search",
                "auth": "user",
                "description": "Search ToDos with a regular expression against title and description.",
                "query_params": {
                    "pattern": "<string, required, regex>",
                    "start_at": "<int | null>",
                    "end_at": "<int | null>",
                    "ignore_case": "<bool, default false>",
                    "open_only": "<bool, default false>",
                    "completed_only": "<bool, default false>",
                },
                "body": None,
                "response": {"ok": True, "pattern": "<string>", "count": "<int>", "todos": "[...]"},
            },
            {
                "method": "GET",
                "path": "/todos/stats",
                "auth": "user",
                "description": "Get ToDo statistics: total, completed count, completion rate, priority distribution.",
                "query_params": {
                    "start_at": "<int | null>",
                    "end_at": "<int | null>",
                },
                "body": None,
                "response": {"ok": True, "stats": {"total": "<int>", "completed": "<int>", "rate": "<float>", "by_priority": "{...}"}},
            },
            {
                "method": "POST",
                "path": "/todos/done",
                "auth": "user",
                "description": "Mark one or more ToDos as completed by their IDs.",
                "query_params": {},
                "body": {"targets": ["<list of int, ToDo IDs>"]},
                "response": {"ok": True, "results": "[{target, ok, todo | error}]"},
            },
            {
                "method": "POST",
                "path": "/todos/reopen",
                "auth": "user",
                "description": "Reopen one or more completed ToDos by their IDs.",
                "query_params": {},
                "body": {"targets": ["<list of int, ToDo IDs>"]},
                "response": {"ok": True, "results": "[{target, ok, todo | error}]"},
            },
            {
                "method": "POST",
                "path": "/todos/remove",
                "auth": "user",
                "description": "Delete one or more ToDos by their IDs.",
                "query_params": {},
                "body": {"targets": ["<list of int, ToDo IDs>"]},
                "response": {"ok": True, "results": "[{target, ok, todo | error}]"},
            },
            {
                "method": "GET",
                "path": "/todos/{todo_id}",
                "auth": "user",
                "description": "Get a single ToDo by ID.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "todo": "{...}"},
            },
            {
                "method": "PATCH",
                "path": "/todos/{todo_id}",
                "auth": "user",
                "description": "Update a ToDo's mutable fields. All fields optional; only provided fields are changed.",
                "query_params": {},
                "body": {
                    "title": "<string | null>",
                    "due_at": "<int | null>",
                    "description": "<string | null>",
                    "priority": "<int | null, min 0>",
                    "tag": "<string | null>",
                },
                "response": {"ok": True, "todo": "{...}"},
            },
            {
                "method": "POST",
                "path": "/schedules",
                "auth": "user",
                "description": "Create a schedule item. Conflicts result in 409 error.",
                "query_params": {},
                "body": {
                    "title": "<string, required>",
                    "start_at": "<int, required, epoch seconds>",
                    "end_at": "<int, required, epoch seconds, must be > start_at>",
                    "description": "<string | null>",
                    "location": "<string | null>",
                    "category": "<string | null>",
                },
                "response": {"ok": True, "schedule": "{id, title, start_at, end_at, description, location, category, created_at, updated_at}"},
            },
            {
                "method": "GET",
                "path": "/schedules",
                "auth": "user",
                "description": "List schedules overlapping a time range. Defaults to now..now+24h.",
                "query_params": {
                    "start_at": "<int | null, epoch seconds, default now>",
                    "end_at": "<int | null, epoch seconds, default start_at+86400>",
                },
                "body": None,
                "response": {"ok": True, "range": {"start_at": "<int>", "end_at": "<int>"}, "count": "<int>", "schedules": "[...]"},
            },
            {
                "method": "GET",
                "path": "/schedules/search",
                "auth": "user",
                "description": "Search schedules with a regular expression against title and description.",
                "query_params": {
                    "pattern": "<string, required, regex>",
                    "start_at": "<int | null>",
                    "end_at": "<int | null>",
                    "ignore_case": "<bool, default false>",
                },
                "body": None,
                "response": {"ok": True, "pattern": "<string>", "count": "<int>", "schedules": "[...]"},
            },
            {
                "method": "GET",
                "path": "/schedules/conflicts",
                "auth": "user",
                "description": "Check for schedule conflicts in a time range before creating an item.",
                "query_params": {
                    "start_at": "<int, required, epoch seconds>",
                    "end_at": "<int, required, epoch seconds>",
                    "exclude_id": "<int | null, exclude a schedule from conflict check>",
                },
                "body": None,
                "response": {"ok": True, "conflict": "<bool>", "count": "<int>", "schedules": "[...]"},
            },
            {
                "method": "GET",
                "path": "/schedules/stats",
                "auth": "user",
                "description": "Get schedule statistics for a time range.",
                "query_params": {
                    "start_at": "<int | null>",
                    "end_at": "<int | null>",
                },
                "body": None,
                "response": {"ok": True, "stats": "{...}"},
            },
            {
                "method": "POST",
                "path": "/schedules/remove",
                "auth": "user",
                "description": "Delete one or more schedules by their IDs.",
                "query_params": {},
                "body": {"targets": ["<list of int, schedule IDs>"]},
                "response": {"ok": True, "results": "[{target, ok, schedule | error}]"},
            },
            {
                "method": "GET",
                "path": "/schedules/{schedule_id}",
                "auth": "user",
                "description": "Get a single schedule by ID.",
                "query_params": {},
                "body": None,
                "response": {"ok": True, "schedule": "{...}"},
            },
            {
                "method": "PATCH",
                "path": "/schedules/{schedule_id}",
                "auth": "user",
                "description": "Update a schedule's mutable fields. All fields optional; only provided fields are changed.",
                "query_params": {},
                "body": {
                    "title": "<string | null>",
                    "start_at": "<int | null>",
                    "end_at": "<int | null>",
                    "description": "<string | null>",
                    "location": "<string | null>",
                    "category": "<string | null>",
                },
                "response": {"ok": True, "schedule": "{...}"},
            },
        ],
        "conventions": {
            "timestamps": "All timestamps are Unix epoch seconds (int).",
            "errors": "Error responses have shape {detail: <string>} with HTTP 4xx/5xx status codes. Domain errors (400/404/409/500) may include {error: {type: <string>, message: <string>}}.",
            "batch_operations": "POST /todos/done, /todos/reopen, /todos/remove, /schedules/remove accept {targets: [int]} and return per-item results. If a target fails, the result includes an error object; successful targets still apply.",
            "pagination": "Not yet implemented. All list endpoints return full result sets.",
        },
    }
