"""Admin routes: health check, database initialization, agent guide, and current user."""

from __future__ import annotations

import base64
import logging
import secrets
import time

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from config import __version__, server_root
from db.base import Base
from models.user import User
from serialization import user_to_dict, user_to_dict_with_token
from server.auth import require_admin, require_localhost, require_user
from server.schemas import AdminConfigRequest, AdminInitDbRequest, UserMeRequest, UserTokenRegenerateRequest

logger = logging.getLogger("amtodo")

router = APIRouter()

# Cache for public IP addresses: {"ipv4": str|None, "ipv6": str|None, "ts": float}
_ip_cache: dict[str, object] = {"ipv4": None, "ipv6": None, "ts": 0.0}


async def _fetch_public_ips(ttl: int) -> tuple[str | None, str | None]:
    """Return cached public IPs, refreshing if older than ttl seconds."""
    now = time.monotonic()
    if ttl > 0 and now - _ip_cache["ts"] < ttl:
        return _ip_cache["ipv4"], _ip_cache["ipv6"]

    async with httpx.AsyncClient(timeout=5.0) as client:
        ipv4, ipv6 = None, None
        try:
            resp = await client.get("http://v4.tcptest.cn")
            resp.raise_for_status()
            ipv4 = resp.text.strip()
        except Exception:
            logger.debug("Failed to fetch IPv4 address from v4.tcptest.cn")
        try:
            resp = await client.get("http://v6.tcptest.cn")
            resp.raise_for_status()
            ipv6 = resp.text.strip()
        except Exception:
            logger.debug("Failed to fetch IPv6 address from v6.tcptest.cn")

    _ip_cache["ipv4"] = ipv4
    _ip_cache["ipv6"] = ipv6
    _ip_cache["ts"] = now
    return ipv4, ipv6


@router.get("/health")
async def health(request: Request) -> dict[str, object]:
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

            root = server_root()
            pub_path = root / settings.server_public_key_path
            if pub_path.is_file():
                raw = public_key_spki(pub_path.read_bytes())
                result["public_key"] = base64.b64encode(raw).decode("ascii")
        except Exception:
            pass

    ipv4, ipv6 = await _fetch_public_ips(settings.ip_cache_ttl_seconds)
    result["ipv4"] = ipv4
    result["ipv6"] = ipv6

    host = settings.server_host
    if host is None:
        result["bind"] = ["ipv4", "ipv6"]
    elif host in ("127.0.0.1", "localhost", "::1"):
        result["bind"] = ["local"]
    elif host == "0.0.0.0":
        result["bind"] = ["ipv4"]
    elif host == "::":
        result["bind"] = ["ipv6"]
    else:
        result["bind"] = [host]

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
                "note": "User tokens are created via CLI. All business endpoints require a valid user token in the JSON body.",
            },
        },
        "conventions": {
            "timestamps": "All timestamps are Unix epoch seconds (int).",
            "auth": "All POST endpoints accept auth via JSON body fields (admin_token or access_token).",
            "errors": "Error responses have shape {detail: <string>} with HTTP 4xx/5xx.",
            "pagination": "Use after_id + limit for keyset pagination. Pass the last item's id as after_id.",
            "soft_delete": "remove() moves items to trash. Use trash/restore to recover, trash/delete to permanently purge.",
        },
        "endpoints": [
            # ── Public ──
            {
                "method": "GET",
                "path": "/health",
                "auth": "none",
                "description": "Return server health status, version, attachment limits, public key, and bound addresses.",
            },
            {
                "method": "GET",
                "path": "/agent-guide",
                "auth": "none",
                "description": "Return this machine-readable API reference.",
            },
            # ── User ──
            {
                "method": "POST",
                "path": "/user",
                "auth": "user",
                "description": "Return the current authenticated user's information.",
                "body": {
                    "access_token": {"type": "string", "required": True, "desc": "User access token."},
                },
            },
            {
                "method": "POST",
                "path": "/user/token/regenerate",
                "auth": "user",
                "description": "Generate a new access token for the current user. The old token is invalidated.",
                "body": {
                    "access_token": {"type": "string", "required": True, "desc": "Current user access token."},
                },
            },
            # ── ToDo CRUD ──
            {
                "method": "POST",
                "path": "/todos/list",
                "auth": "user",
                "description": "List ToDos planned in an optional epoch range. When both start_at and end_at are omitted, returns all ToDos.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int|null", "default": None, "desc": "Planned-at range start (inclusive)."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Planned-at range end (exclusive). Defaults to start_at + 86400 when start_at is set."},
                    "open_only": {"type": "bool", "default": False, "desc": "Only return open (incomplete) ToDos."},
                    "completed_only": {"type": "bool", "default": False, "desc": "Only return completed ToDos."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/search",
                "auth": "user",
                "description": "Search ToDos with text query, regex, multiple time-range filters, status filters, sorting, and keyset pagination.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "query": {"type": "string", "default": "", "desc": "Search text matched against selected fields."},
                    "use_regex": {"type": "bool", "default": False, "desc": "Treat query as a regular expression."},
                    "ignore_case": {"type": "bool", "default": True, "desc": "Case-insensitive search."},
                    "fields": {"type": "list[str]", "default": ["title", "description", "tag"], "desc": "Fields to search in."},
                    "start_at": {"type": "int|null", "default": None, "desc": "Planned-at range start."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Planned-at range end."},
                    "planned_start_at": {"type": "int|null", "default": None, "desc": "Explicit planned_at range start."},
                    "planned_end_at": {"type": "int|null", "default": None, "desc": "Explicit planned_at range end."},
                    "due_start_at": {"type": "int|null", "default": None, "desc": "Due-at range start."},
                    "due_end_at": {"type": "int|null", "default": None, "desc": "Due-at range end."},
                    "created_start_at": {"type": "int|null", "default": None, "desc": "Created-at range start."},
                    "created_end_at": {"type": "int|null", "default": None, "desc": "Created-at range end."},
                    "updated_start_at": {"type": "int|null", "default": None, "desc": "Updated-at range start."},
                    "updated_end_at": {"type": "int|null", "default": None, "desc": "Updated-at range end."},
                    "open_only": {"type": "bool", "default": False, "desc": "Only search open ToDos."},
                    "completed_only": {"type": "bool", "default": False, "desc": "Only search completed ToDos."},
                    "completed": {"type": "bool|null", "default": None, "desc": "Filter by completion status (alternative to open_only/completed_only)."},
                    "priority_min": {"type": "int|null", "default": None, "desc": "Minimum priority (inclusive, >= 0)."},
                    "priority_max": {"type": "int|null", "default": None, "desc": "Maximum priority (inclusive, >= 0)."},
                    "tag": {"type": "string|null", "default": None, "desc": "Exact tag match."},
                    "sort_by": {"type": "string", "default": "updated_at", "desc": "Sort field. One of: updated_at, created_at, planned_at, due_at, priority."},
                    "sort_order": {"type": "string", "default": "desc", "desc": "Sort direction: asc or desc."},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500, "desc": "Max items to return."},
                    "after_id": {"type": "int|null", "default": None, "desc": "Keyset pagination cursor. Pass the last item's id."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/stats",
                "auth": "user",
                "description": "Return ToDo statistics: total, open, completed counts and completion rate.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int|null", "default": None, "desc": "Planned-at range start."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Planned-at range end."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/create",
                "auth": "user",
                "description": "Create a single ToDo item.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "title": {"type": "string", "required": True, "desc": "ToDo title."},
                    "planned_at": {"type": "int|null", "default": None, "desc": "Planned start time (epoch)."},
                    "due_at": {"type": "int|null", "default": None, "desc": "Due date (epoch)."},
                    "description": {"type": "string|null", "default": None, "desc": "Optional details."},
                    "priority": {"type": "int", "default": 0, "min": 0, "desc": "Higher values sort first."},
                    "tag": {"type": "string|null", "default": None, "desc": "Optional tag."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/get",
                "auth": "user",
                "description": "Return a single ToDo by id.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True, "desc": "ToDo id."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/update",
                "auth": "user",
                "description": "Update mutable fields of a ToDo. Only provided fields are changed.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True, "desc": "ToDo id to update."},
                    "title": {"type": "string|null", "default": None, "desc": "New title."},
                    "planned_at": {"type": "int|null", "default": None, "desc": "New planned-at time (epoch)."},
                    "due_at": {"type": "int|null", "default": None, "desc": "New due date (epoch)."},
                    "description": {"type": "string|null", "default": None, "desc": "New description."},
                    "priority": {"type": "int|null", "default": None, "min": 0, "desc": "New priority."},
                    "tag": {"type": "string|null", "default": None, "desc": "New tag."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/done",
                "auth": "user",
                "description": "Mark one or more ToDos as completed. Targets are deduplicated.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True, "desc": "List of ToDo ids."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/reopen",
                "auth": "user",
                "description": "Mark one or more ToDos as open (incomplete).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True, "desc": "List of ToDo ids."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/remove",
                "auth": "user",
                "description": "Soft-delete one or more ToDos (move to trash). Use trash/restore to recover.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True, "desc": "List of ToDo ids."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/batch-create",
                "auth": "user",
                "description": "Create multiple ToDo items at once. Per-item error handling: overall ok is false if any item fails.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "items": {"type": "list[object]", "required": True, "desc": "Each item has: title (str, required), planned_at (int|null), due_at (int|null), description (str|null), priority (int, default 0), tag (str|null)."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/batch-update",
                "auth": "user",
                "description": "Update multiple ToDo items at once. Per-item error handling.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "items": {"type": "list[object]", "required": True, "desc": "Each item has: id (int, required), plus any mutable fields: title, planned_at, due_at, description, priority, tag."},
                },
            },
            # ── ToDo Trash ──
            {
                "method": "POST",
                "path": "/todos/trash/list",
                "auth": "user",
                "description": "List soft-deleted (trashed) ToDos with the same search filters as /todos/search.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "query": {"type": "string", "default": ""},
                    "use_regex": {"type": "bool", "default": False},
                    "ignore_case": {"type": "bool", "default": True},
                    "fields": {"type": "list[str]", "default": ["title", "description", "tag"]},
                    "planned_start_at": {"type": "int|null", "default": None},
                    "planned_end_at": {"type": "int|null", "default": None},
                    "due_start_at": {"type": "int|null", "default": None},
                    "due_end_at": {"type": "int|null", "default": None},
                    "created_start_at": {"type": "int|null", "default": None},
                    "created_end_at": {"type": "int|null", "default": None},
                    "updated_start_at": {"type": "int|null", "default": None},
                    "updated_end_at": {"type": "int|null", "default": None},
                    "completed": {"type": "bool|null", "default": None},
                    "priority_min": {"type": "int|null", "default": None},
                    "priority_max": {"type": "int|null", "default": None},
                    "tag": {"type": "string|null", "default": None},
                    "sort_by": {"type": "string", "default": "updated_at"},
                    "sort_order": {"type": "string", "default": "desc"},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/todos/trash/restore",
                "auth": "user",
                "description": "Restore one or more soft-deleted ToDos.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True, "desc": "List of trashed ToDo ids."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/trash/delete",
                "auth": "user",
                "description": "Permanently delete one or more soft-deleted ToDos and their attachments.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True, "desc": "List of trashed ToDo ids."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/changelog",
                "auth": "user",
                "description": "Query ToDo changelog entries (audit trail of create/update/delete/done/reopen actions).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "entity_id": {"type": "int|null", "default": None, "desc": "Filter by specific ToDo id."},
                    "action": {"type": "string|null", "default": None, "desc": "Filter by action type."},
                    "start_at": {"type": "int|null", "default": None, "desc": "Time range start (epoch)."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Time range end (epoch)."},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None, "desc": "Keyset pagination cursor."},
                },
            },
            # ── ToDo Attachments ──
            {
                "method": "POST",
                "path": "/todos/attachments/list",
                "auth": "user",
                "description": "List encrypted attachment metadata for a ToDo.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True, "desc": "ToDo id."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/attachments/get",
                "auth": "user",
                "description": "Return encrypted attachment metadata for a specific attachment.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/todos/attachments/upload",
                "auth": "user",
                "description": "Upload a file attachment via encrypted JSON (base64-encoded content).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True},
                    "filename": {"type": "string", "required": True, "desc": "Original filename."},
                    "content_base64": {"type": "string", "required": True, "desc": "Base64-encoded file content."},
                    "mime_type": {"type": "string|null", "default": None, "desc": "MIME type. Auto-detected if omitted."},
                },
            },
            {
                "method": "POST",
                "path": "/todos/attachments/download",
                "auth": "user",
                "description": "Download encrypted attachment bytes (returned as base64 in JSON).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/todos/attachments/remove",
                "auth": "user",
                "description": "Remove an attachment from a ToDo.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/todos/attachments/remove-orphaned",
                "auth": "user",
                "description": "Remove orphaned attachment metadata for a ToDo (metadata exists but file is missing).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "todo_id": {"type": "int", "required": True},
                },
            },
            # ── Schedule CRUD ──
            {
                "method": "POST",
                "path": "/schedules/list",
                "auth": "user",
                "description": "List schedules overlapping an epoch range. Defaults: start_at=now, end_at=start_at+86400.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int|null", "default": None, "desc": "Range start (inclusive). Defaults to current epoch."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Range end (exclusive). Defaults to start_at + 86400."},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/search",
                "auth": "user",
                "description": "Search schedules with text query, regex, time-range filters, category/location filters, sorting, and pagination.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "query": {"type": "string", "default": "", "desc": "Search text matched against selected fields."},
                    "use_regex": {"type": "bool", "default": False, "desc": "Treat query as a regular expression."},
                    "ignore_case": {"type": "bool", "default": True, "desc": "Case-insensitive search."},
                    "fields": {"type": "list[str]", "default": ["title", "description", "location", "category"], "desc": "Fields to search in."},
                    "start_at": {"type": "int|null", "default": None, "desc": "Time range start (overlapping schedules)."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Time range end."},
                    "created_start_at": {"type": "int|null", "default": None},
                    "created_end_at": {"type": "int|null", "default": None},
                    "updated_start_at": {"type": "int|null", "default": None},
                    "updated_end_at": {"type": "int|null", "default": None},
                    "category": {"type": "string|null", "default": None, "desc": "Exact category match."},
                    "location": {"type": "string|null", "default": None, "desc": "Exact location match."},
                    "sort_by": {"type": "string", "default": "updated_at", "desc": "Sort field: updated_at, created_at, start_at, end_at."},
                    "sort_order": {"type": "string", "default": "desc"},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/stats",
                "auth": "user",
                "description": "Return schedule statistics for a time range.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int|null", "default": None},
                    "end_at": {"type": "int|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/conflicts",
                "auth": "user",
                "description": "Check for schedules that overlap a given time range. Use before creating a schedule.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int", "required": True, "desc": "Proposed start time (epoch)."},
                    "end_at": {"type": "int", "required": True, "desc": "Proposed end time (epoch)."},
                    "exclude_id": {"type": "int|null", "default": None, "desc": "Schedule id to exclude from conflict check (for updates)."},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/create",
                "auth": "user",
                "description": "Create a single schedule item.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "title": {"type": "string", "required": True, "desc": "Schedule title."},
                    "start_at": {"type": "int", "required": True, "desc": "Start time (epoch)."},
                    "end_at": {"type": "int", "required": True, "desc": "End time (epoch)."},
                    "description": {"type": "string|null", "default": None},
                    "location": {"type": "string|null", "default": None},
                    "category": {"type": "string|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/get",
                "auth": "user",
                "description": "Return a single schedule by id.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/update",
                "auth": "user",
                "description": "Update mutable fields of a schedule. Only provided fields are changed.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                    "title": {"type": "string|null", "default": None},
                    "start_at": {"type": "int|null", "default": None},
                    "end_at": {"type": "int|null", "default": None},
                    "description": {"type": "string|null", "default": None},
                    "location": {"type": "string|null", "default": None},
                    "category": {"type": "string|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/remove",
                "auth": "user",
                "description": "Soft-delete one or more schedules (move to trash).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/batch-create",
                "auth": "user",
                "description": "Create multiple schedule items at once. Per-item error handling.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "items": {"type": "list[object]", "required": True, "desc": "Each item has: title (str, required), start_at (int, required), end_at (int, required), description (str|null), location (str|null), category (str|null)."},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/batch-update",
                "auth": "user",
                "description": "Update multiple schedule items at once. Per-item error handling.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "items": {"type": "list[object]", "required": True, "desc": "Each item has: id (int, required), plus any mutable fields: title, start_at, end_at, description, location, category."},
                },
            },
            # ── Schedule Trash ──
            {
                "method": "POST",
                "path": "/schedules/trash/list",
                "auth": "user",
                "description": "List soft-deleted schedules with the same search filters as /schedules/search.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "query": {"type": "string", "default": ""},
                    "use_regex": {"type": "bool", "default": False},
                    "ignore_case": {"type": "bool", "default": True},
                    "fields": {"type": "list[str]", "default": ["title", "description", "location", "category"]},
                    "start_at": {"type": "int|null", "default": None},
                    "end_at": {"type": "int|null", "default": None},
                    "created_start_at": {"type": "int|null", "default": None},
                    "created_end_at": {"type": "int|null", "default": None},
                    "updated_start_at": {"type": "int|null", "default": None},
                    "updated_end_at": {"type": "int|null", "default": None},
                    "category": {"type": "string|null", "default": None},
                    "location": {"type": "string|null", "default": None},
                    "sort_by": {"type": "string", "default": "updated_at"},
                    "sort_order": {"type": "string", "default": "desc"},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/trash/restore",
                "auth": "user",
                "description": "Restore one or more soft-deleted schedules.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/trash/delete",
                "auth": "user",
                "description": "Permanently delete one or more soft-deleted schedules.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "targets": {"type": "list[int]", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/changelog",
                "auth": "user",
                "description": "Query schedule changelog entries (audit trail).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "entity_id": {"type": "int|null", "default": None, "desc": "Filter by specific schedule id."},
                    "action": {"type": "string|null", "default": None, "desc": "Filter by action type."},
                    "start_at": {"type": "int|null", "default": None},
                    "end_at": {"type": "int|null", "default": None},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None},
                },
            },
            # ── Schedule Attachments ──
            {
                "method": "POST",
                "path": "/schedules/attachments/list",
                "auth": "user",
                "description": "List encrypted attachment metadata for a schedule.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/attachments/get",
                "auth": "user",
                "description": "Return encrypted attachment metadata for a specific attachment.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/attachments/upload",
                "auth": "user",
                "description": "Upload a file attachment via encrypted JSON (base64-encoded content).",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                    "filename": {"type": "string", "required": True},
                    "content_base64": {"type": "string", "required": True},
                    "mime_type": {"type": "string|null", "default": None},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/attachments/download",
                "auth": "user",
                "description": "Download encrypted attachment bytes.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/attachments/remove",
                "auth": "user",
                "description": "Remove an attachment from a schedule.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                    "attachment_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/schedules/attachments/remove-orphaned",
                "auth": "user",
                "description": "Remove orphaned attachment metadata for a schedule.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "schedule_id": {"type": "int", "required": True},
                },
            },
            # ── Notifications ──
            {
                "method": "POST",
                "path": "/notifications/create",
                "auth": "user",
                "description": "Create a notification with optional mentions linking to todos or schedules.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "title": {"type": "string", "required": True, "desc": "Notification title."},
                    "trigger_at": {"type": "int", "required": True, "desc": "Epoch time when the notification should fire."},
                    "description": {"type": "string|null", "default": None, "desc": "Optional details."},
                    "mentions": {"type": "list[object]", "default": [], "desc": "Each mention has: target_type ('todo'|'schedule'), target_id (int)."},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/get",
                "auth": "user",
                "description": "Return a single notification by id.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "notification_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/update",
                "auth": "user",
                "description": "Update mutable notification fields.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "notification_id": {"type": "int", "required": True},
                    "title": {"type": "string|null", "default": None},
                    "description": {"type": "string|null", "default": None},
                    "trigger_at": {"type": "int|null", "default": None},
                    "mentions": {"type": "list[object]|null", "default": None, "desc": "Replace mentions list. Each: {target_type, target_id}."},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/remove",
                "auth": "user",
                "description": "Soft-delete a notification.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "notification_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/list",
                "auth": "user",
                "description": "List notifications in an optional time range.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "start_at": {"type": "int|null", "default": None, "desc": "Trigger-at range start."},
                    "end_at": {"type": "int|null", "default": None, "desc": "Trigger-at range end."},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/list_triggered",
                "auth": "user",
                "description": "List notifications that have triggered after a given epoch timestamp. Used for polling.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "after": {"type": "int", "required": True, "desc": "Return notifications triggered after this epoch."},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/trash/list",
                "auth": "user",
                "description": "List soft-deleted notifications.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/trash/restore",
                "auth": "user",
                "description": "Restore a soft-deleted notification.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "notification_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/trash/delete",
                "auth": "user",
                "description": "Permanently delete a soft-deleted notification.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "notification_id": {"type": "int", "required": True},
                },
            },
            {
                "method": "POST",
                "path": "/notifications/changelog",
                "auth": "user",
                "description": "Query notification changelog entries.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                    "entity_id": {"type": "int|null", "default": None},
                    "action": {"type": "string|null", "default": None},
                    "start_at": {"type": "int|null", "default": None},
                    "end_at": {"type": "int|null", "default": None},
                    "limit": {"type": "int", "default": 50, "min": 1, "max": 500},
                    "after_id": {"type": "int|null", "default": None},
                },
            },
            # ── WebSocket ──
            {
                "method": "POST",
                "path": "/notifications/ws-key",
                "auth": "user",
                "description": "Return a new AES-256-GCM session key for WebSocket encryption. The key is returned once and cannot be retrieved again.",
                "body": {
                    "access_token": {"type": "string", "required": True},
                },
            },
            {
                "method": "WS",
                "path": "/notifications/ws",
                "auth": "user (query param: token)",
                "description": "WebSocket endpoint for real-time notification push. Connect with ?token=<access_token>. Receives encrypted notification payloads. Send 'ping' to keep alive.",
            },
        ],
    }


def init_db(
    body: AdminInitDbRequest,
    request: Request,
    _localhost: None = Depends(require_localhost),
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Initialize database schema and stamp Alembic as current."""
    db = request.app.state.db
    Base.metadata.create_all(db.engine)
    db.stamp_head()
    return {"ok": True, "database": "initialized"}


def server_config(
    body: AdminConfigRequest,
    request: Request,
    _localhost: None = Depends(require_localhost),
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


@router.post("/user/token/regenerate")
def regenerate_token(
    body: UserTokenRegenerateRequest,
    request: Request,
    user_id: int = Depends(require_user),
) -> dict[str, object]:
    """Generate a new access token for the current user. Invalidates the old one."""
    new_token = secrets.token_hex(64)
    db = request.app.state.db
    token_map: dict[str, int] = request.app.state.token_map

    with db.session() as session:
        user = session.get(User, user_id)
        if user is None:
            from exceptions import NotFoundError
            raise NotFoundError("User not found")
        old_token = user.token
        user.token = new_token
        session.flush()

    # Update in-memory token map
    token_map.pop(old_token, None)
    token_map[new_token] = user_id

    return {"ok": True, "user": user_to_dict_with_token(user)}
