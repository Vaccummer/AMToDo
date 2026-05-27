"""HTTP client wrapper for the AMToDo server API (v0.2.0)."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from config import AppSettings


class AMTodoClient:
    """Thin HTTP client that mirrors the service API over REST."""

    def __init__(self, settings: AppSettings) -> None:
        self._base = settings.server_url.rstrip("/")
        self._admin_token = settings.admin_token
        self._access_token = settings.access_token
        self._client = httpx.Client(
            base_url=self._base,
            timeout=30.0,
            http2=True,
        )

    def close(self) -> None:
        self._client.close()

    # ── unauthenticated ──

    def health(self) -> dict[str, Any]:
        return self._get("/api/v1/health")

    def agent_guide(self) -> dict[str, Any]:
        return self._get("/api/v1/agent-guide")

    # ── admin (admin_token) ──

    # ── user ──

    def user_me(self) -> dict[str, Any]:
        return self._user_post("/api/v1/user")

    def user_update_self(self, name: str) -> dict[str, Any]:
        return self._user_post("/api/v1/user/update", {"name": name})

    def user_regen_token_self(self) -> dict[str, Any]:
        return self._user_post("/api/v1/user/token/regenerate")

    # ── admin users ──

    def user_create(self, name: str) -> dict[str, Any]:
        return self._admin_post("/api/v1/admin/users/create", {"name": name})

    def user_list(self) -> dict[str, Any]:
        return self._admin_post("/api/v1/admin/users/list")

    def user_delete(self, user_id: int) -> dict[str, Any]:
        return self._admin_post("/api/v1/admin/users/delete", {"user_id": user_id})

    def user_update(self, user_id: int, name: str) -> dict[str, Any]:
        return self._admin_post("/api/v1/admin/users/update", {"user_id": user_id, "name": name})

    def user_regenerate_token(self, user_id: int) -> dict[str, Any]:
        return self._admin_post("/api/v1/admin/users/regen-token", {"user_id": user_id})

    # ── todos ──

    def todo_create(
        self,
        title: str,
        planned_at: int | None = None,
        due_at: int | None = None,
        description: str | None = None,
        priority: int = 0,
        tag: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "priority": priority}
        if planned_at is not None:
            body["planned_at"] = planned_at
        if due_at is not None:
            body["due_at"] = due_at
        if description is not None:
            body["description"] = description
        if tag is not None:
            body["tag"] = tag
        return self._user_post("/api/v1/todos/create", body)

    def todo_list(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
        open_only: bool = False,
        completed_only: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        if open_only:
            body["open_only"] = True
        if completed_only:
            body["completed_only"] = True
        return self._user_post("/api/v1/todos/list", body)

    def todo_search(
        self,
        query: str,
        fields: list[str] | None = None,
        use_regex: bool = False,
        ignore_case: bool = True,
        planned_start_at: int | None = None,
        planned_end_at: int | None = None,
        due_start_at: int | None = None,
        due_end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        open_only: bool = False,
        completed_only: bool = False,
        completed: bool | None = None,
        priority_min: int | None = None,
        priority_max: int | None = None,
        tag: str | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "query": query,
            "use_regex": use_regex,
            "ignore_case": ignore_case,
            "sort_by": sort_by,
            "sort_order": sort_order,
            "limit": limit,
            "offset": offset,
        }
        if fields is not None:
            body["fields"] = fields
        if planned_start_at is not None:
            body["planned_start_at"] = planned_start_at
        if planned_end_at is not None:
            body["planned_end_at"] = planned_end_at
        if due_start_at is not None:
            body["due_start_at"] = due_start_at
        if due_end_at is not None:
            body["due_end_at"] = due_end_at
        if created_start_at is not None:
            body["created_start_at"] = created_start_at
        if created_end_at is not None:
            body["created_end_at"] = created_end_at
        if updated_start_at is not None:
            body["updated_start_at"] = updated_start_at
        if updated_end_at is not None:
            body["updated_end_at"] = updated_end_at
        if open_only:
            body["open_only"] = True
        if completed_only:
            body["completed_only"] = True
        if completed is not None:
            body["completed"] = completed
        if priority_min is not None:
            body["priority_min"] = priority_min
        if priority_max is not None:
            body["priority_max"] = priority_max
        if tag is not None:
            body["tag"] = tag
        return self._user_post("/api/v1/todos/search", body)

    def todo_get(self, todo_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/get", {"todo_id": todo_id})

    def todo_update(self, todo_id: int, **fields: object) -> dict[str, Any]:
        body: dict[str, Any] = {"todo_id": todo_id, **fields}
        return self._user_post("/api/v1/todos/update", body)

    def todo_done(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/done", {"targets": targets})

    def todo_reopen(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/reopen", {"targets": targets})

    def todo_remove(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/remove", {"targets": targets})

    def todo_stats(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/todos/stats", body)

    def todo_batch_create(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/batch-create", {"items": items})

    def todo_batch_update(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/batch-update", {"items": items})

    # ── unified trash ──

    def trash_get(self, *, todo_id: int | None = None, schedule_id: int | None = None, notification_id: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if todo_id is not None:
            body["todo_id"] = todo_id
        elif schedule_id is not None:
            body["schedule_id"] = schedule_id
        elif notification_id is not None:
            body["notification_id"] = notification_id
        return self._user_post("/api/v1/trash/get", body)

    def trash_update(self, *, todo_id: int | None = None, schedule_id: int | None = None, notification_id: int | None = None, **fields: object) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if todo_id is not None:
            body["todo_id"] = todo_id
        elif schedule_id is not None:
            body["schedule_id"] = schedule_id
        elif notification_id is not None:
            body["notification_id"] = notification_id
        body.update(fields)
        return self._user_post("/api/v1/trash/update", body)

    def trash_list(self, entity_type: str, **filters: object) -> dict[str, Any]:
        body: dict[str, Any] = {"entity_type": entity_type}
        body.update(filters)
        return self._user_post("/api/v1/trash/list", body)

    def trash_restore(self, *, targets: list[int] | None = None, notification_id: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if targets is not None:
            body["targets"] = targets
        elif notification_id is not None:
            body["notification_id"] = notification_id
        return self._user_post("/api/v1/trash/restore", body)

    def trash_delete(self, *, targets: list[int] | None = None, notification_id: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if targets is not None:
            body["targets"] = targets
        elif notification_id is not None:
            body["notification_id"] = notification_id
        return self._user_post("/api/v1/trash/delete", body)

    def todo_changelog(
        self,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"limit": limit, "offset": offset}
        if entity_id is not None:
            body["entity_id"] = entity_id
        if action is not None:
            body["action"] = action
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/todos/changelog", body)

    def todo_attachment_upload(self, todo_id: int, file_path: Path) -> dict[str, Any]:
        content_base64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
        return self._user_post(
            "/api/v1/attachment/upload",
            {
                "todo_id": todo_id,
                "filename": file_path.name,
                "content_base64": content_base64,
            },
        )

    def todo_attachment_list(self, todo_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/attachment/list", {"todo_id": todo_id})

    def todo_attachment_get(self, todo_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/get",
            {"todo_id": todo_id, "attachment_id": attachment_id},
        )

    def todo_attachment_remove(self, todo_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/remove",
            {"todo_id": todo_id, "attachment_id": attachment_id},
        )

    def todo_attachment_rename(self, todo_id: int, attachment_id: int, filename: str) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/rename",
            {"todo_id": todo_id, "attachment_id": attachment_id, "filename": filename},
        )

    def todo_attachment_download(self, todo_id: int, attachment_id: int) -> bytes:
        response = self._client.post(
            "/api/v1/attachment/download",
            json={"todo_id": todo_id, "attachment_id": attachment_id},
            headers=self._user_headers(),
        )
        response.raise_for_status()
        return response.content

    def todo_attachment_remove_orphaned(self, todo_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/attachment/remove-orphaned", {"todo_id": todo_id})

    # ── schedules ──

    def schedule_create(
        self,
        title: str,
        start_at: int,
        end_at: int,
        description: str | None = None,
        location: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "start_at": start_at, "end_at": end_at}
        if description is not None:
            body["description"] = description
        if location is not None:
            body["location"] = location
        if category is not None:
            body["category"] = category
        return self._user_post("/api/v1/schedules/create", body)

    def schedule_list(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/schedules/list", body)

    def schedule_search(
        self,
        query: str,
        fields: list[str] | None = None,
        use_regex: bool = False,
        ignore_case: bool = True,
        start_at: int | None = None,
        end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        category: str | None = None,
        location: str | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "query": query,
            "use_regex": use_regex,
            "ignore_case": ignore_case,
            "sort_by": sort_by,
            "sort_order": sort_order,
            "limit": limit,
            "offset": offset,
        }
        if fields is not None:
            body["fields"] = fields
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        if created_start_at is not None:
            body["created_start_at"] = created_start_at
        if created_end_at is not None:
            body["created_end_at"] = created_end_at
        if updated_start_at is not None:
            body["updated_start_at"] = updated_start_at
        if updated_end_at is not None:
            body["updated_end_at"] = updated_end_at
        if category is not None:
            body["category"] = category
        if location is not None:
            body["location"] = location
        return self._user_post("/api/v1/schedules/search", body)

    def schedule_get(self, schedule_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/get", {"schedule_id": schedule_id})

    def schedule_update(self, schedule_id: int, **fields: object) -> dict[str, Any]:
        body: dict[str, Any] = {"schedule_id": schedule_id, **fields}
        return self._user_post("/api/v1/schedules/update", body)

    def schedule_remove(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/remove", {"targets": targets})

    def schedule_conflicts(
        self,
        start_at: int,
        end_at: int,
        exclude_id: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"start_at": start_at, "end_at": end_at}
        if exclude_id is not None:
            body["exclude_id"] = exclude_id
        return self._user_post("/api/v1/schedules/conflicts", body)

    def schedule_stats(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/schedules/stats", body)

    def schedule_batch_create(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/batch-create", {"items": items})

    def schedule_batch_update(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/batch-update", {"items": items})


    def schedule_changelog(
        self,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"limit": limit, "offset": offset}
        if entity_id is not None:
            body["entity_id"] = entity_id
        if action is not None:
            body["action"] = action
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/schedules/changelog", body)

    # ── schedule attachments ──

    def schedule_attachment_list(self, schedule_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/attachment/list", {"schedule_id": schedule_id})

    def schedule_attachment_get(self, schedule_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/get",
            {"schedule_id": schedule_id, "attachment_id": attachment_id},
        )

    def schedule_attachment_upload(self, schedule_id: int, file_path: Path) -> dict[str, Any]:
        content_base64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
        return self._user_post(
            "/api/v1/attachment/upload",
            {
                "schedule_id": schedule_id,
                "filename": file_path.name,
                "content_base64": content_base64,
            },
        )

    def schedule_attachment_download(self, schedule_id: int, attachment_id: int) -> bytes:
        response = self._client.post(
            "/api/v1/attachment/download",
            json={"schedule_id": schedule_id, "attachment_id": attachment_id},
            headers=self._user_headers(),
        )
        response.raise_for_status()
        return response.content

    def schedule_attachment_remove(self, schedule_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/remove",
            {"schedule_id": schedule_id, "attachment_id": attachment_id},
        )

    def schedule_attachment_rename(self, schedule_id: int, attachment_id: int, filename: str) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/attachment/rename",
            {"schedule_id": schedule_id, "attachment_id": attachment_id, "filename": filename},
        )

    def schedule_attachment_remove_orphaned(self, schedule_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/attachment/remove-orphaned", {"schedule_id": schedule_id})

    # ── notifications ──

    def notification_create(
        self,
        title: str,
        trigger_at: int,
        *,
        description: str | None = None,
        extra_fields: str = "{}",
        mentions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "title": title,
            "trigger_at": trigger_at,
            "extra_fields": extra_fields,
        }
        if description is not None:
            body["description"] = description
        if mentions is not None:
            body["mentions"] = mentions
        return self._user_post("/api/v1/notifications/create", body)

    def notification_get(self, notification_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/notifications/get", {"notification_id": notification_id})

    def notification_list(self, *, start_at: int | None = None, end_at: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        return self._user_post("/api/v1/notifications/list", body)

    def notification_list_triggered(self, after: int) -> dict[str, Any]:
        return self._user_post("/api/v1/notifications/list_triggered", {"after": after})

    def notification_update(self, notification_id: int, **fields: object) -> dict[str, Any]:
        body: dict[str, Any] = {"notification_id": notification_id, **fields}
        return self._user_post("/api/v1/notifications/update", body)

    def notification_remove(self, notification_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/notifications/remove", {"notification_id": notification_id})

    def notification_changelog(
        self,
        *,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        after_id: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"limit": limit}
        if entity_id is not None:
            body["entity_id"] = entity_id
        if action is not None:
            body["action"] = action
        if start_at is not None:
            body["start_at"] = start_at
        if end_at is not None:
            body["end_at"] = end_at
        if after_id is not None:
            body["after_id"] = after_id
        return self._user_post("/api/v1/notifications/changelog", body)

    # ── internal helpers ──

    def _get(self, path: str) -> dict[str, Any]:
        try:
            response = self._client.get(path)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            return _error_from_response(exc)
        except httpx.RequestError as exc:
            return {"ok": False, "error": {"type": "ConnectionError", "message": str(exc)}}

    def _admin_post(self, path: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if extra:
            body.update(extra)
        return self._post(path, body, self._admin_headers())

    def _user_post(self, path: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if extra:
            body.update(extra)
        return self._post(path, body, self._user_headers())

    def _post(self, path: str, body: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        try:
            response = self._client.post(path, json=body, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            return _error_from_response(exc)
        except httpx.RequestError as exc:
            return {"ok": False, "error": {"type": "ConnectionError", "message": str(exc)}}

    def _admin_headers(self) -> dict[str, str]:
        return _bearer_headers(self._admin_token)

    def _user_headers(self) -> dict[str, str]:
        return _bearer_headers(self._access_token)


def _error_from_response(exc: httpx.HTTPStatusError) -> dict[str, Any]:
    try:
        body = exc.response.json()
        if isinstance(body, dict) and "detail" in body and "error" not in body:
            return {
                "ok": False,
                "error": {
                    "type": "HTTPError",
                    "message": str(body["detail"]),
                    "status_code": exc.response.status_code,
                },
            }
        return body
    except Exception:
        return {"ok": False, "error": {"type": "HTTPError", "message": str(exc)}}


def _bearer_headers(token: str) -> dict[str, str]:
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}
