"""HTTP client wrapper for the AMToDo server API (v0.2.0)."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from config import AppSettings, cli_root


class AMTodoClient:
    """Thin HTTP client that mirrors the service API over REST."""

    def __init__(self, settings: AppSettings) -> None:
        self._base = settings.server_url.rstrip("/")
        self._admin_token = settings.admin_token
        self._access_token = settings.access_token
        self._client = httpx.Client(
            base_url=self._base,
            timeout=30.0,
        )
        self._public_key_pem: bytes | None = None
        self._public_key_path = settings.server_public_key_path
        if self._public_key_path:
            key_path = Path(self._public_key_path)
            if not key_path.is_absolute():
                key_path = cli_root() / self._public_key_path
            if key_path.is_file():
                self._public_key_pem = key_path.read_bytes()

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

    def todo_trash_list(self, **kwargs: Any) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/trash/list", kwargs)

    def todo_trash_restore(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/trash/restore", {"targets": targets})

    def todo_trash_delete(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/trash/delete", {"targets": targets})

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
            "/api/v1/todos/attachments/upload",
            {
                "todo_id": todo_id,
                "filename": file_path.name,
                "content_base64": content_base64,
            },
        )

    def todo_attachment_list(self, todo_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/attachments/list", {"todo_id": todo_id})

    def todo_attachment_get(self, todo_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/todos/attachments/get",
            {"todo_id": todo_id, "attachment_id": attachment_id},
        )

    def todo_attachment_remove(self, todo_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/todos/attachments/remove",
            {"todo_id": todo_id, "attachment_id": attachment_id},
        )

    def todo_attachment_rename(self, todo_id: int, attachment_id: int, filename: str) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/todos/attachments/rename",
            {"todo_id": todo_id, "attachment_id": attachment_id, "filename": filename},
        )

    def todo_attachment_download(self, todo_id: int, attachment_id: int) -> bytes:
        data_key: bytes | None = None
        body: dict[str, Any] = {"access_token": self._access_token, "todo_id": todo_id, "attachment_id": attachment_id}
        if self._public_key_pem:
            from amtodo_crypto import seal

            envelope, data_key = seal(body, self._public_key_pem, "server-key-v1")
            body = envelope

        response = self._client.post(
            "/api/v1/todos/attachments/download",
            json=body,
        )
        response.raise_for_status()
        return response.content

    def todo_attachment_remove_orphaned(self, todo_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/todos/attachments/remove-orphaned", {"todo_id": todo_id})

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

    def schedule_trash_list(self, **kwargs: Any) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/trash/list", kwargs)

    def schedule_trash_restore(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/trash/restore", {"targets": targets})

    def schedule_trash_delete(self, targets: list[int]) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/trash/delete", {"targets": targets})

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
        return self._user_post("/api/v1/schedules/attachments/list", {"schedule_id": schedule_id})

    def schedule_attachment_get(self, schedule_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/schedules/attachments/get",
            {"schedule_id": schedule_id, "attachment_id": attachment_id},
        )

    def schedule_attachment_upload(self, schedule_id: int, file_path: Path) -> dict[str, Any]:
        content_base64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
        return self._user_post(
            "/api/v1/schedules/attachments/upload",
            {
                "schedule_id": schedule_id,
                "filename": file_path.name,
                "content_base64": content_base64,
            },
        )

    def schedule_attachment_download(self, schedule_id: int, attachment_id: int) -> bytes:
        data_key: bytes | None = None
        body: dict[str, Any] = {"access_token": self._access_token, "schedule_id": schedule_id, "attachment_id": attachment_id}
        if self._public_key_pem:
            from amtodo_crypto import seal

            envelope, data_key = seal(body, self._public_key_pem, "server-key-v1")
            body = envelope

        response = self._client.post(
            "/api/v1/schedules/attachments/download",
            json=body,
        )
        response.raise_for_status()
        return response.content

    def schedule_attachment_remove(self, schedule_id: int, attachment_id: int) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/schedules/attachments/remove",
            {"schedule_id": schedule_id, "attachment_id": attachment_id},
        )

    def schedule_attachment_rename(self, schedule_id: int, attachment_id: int, filename: str) -> dict[str, Any]:
        return self._user_post(
            "/api/v1/schedules/attachments/rename",
            {"schedule_id": schedule_id, "attachment_id": attachment_id, "filename": filename},
        )

    def schedule_attachment_remove_orphaned(self, schedule_id: int) -> dict[str, Any]:
        return self._user_post("/api/v1/schedules/attachments/remove-orphaned", {"schedule_id": schedule_id})

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
        if self._admin_token:
            body["admin_token"] = self._admin_token
        if extra:
            body.update(extra)
        return self._post(path, body)

    def _user_post(self, path: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if self._access_token:
            body["access_token"] = self._access_token
        if extra:
            body.update(extra)
        return self._post(path, body)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data_key: bytes | None = None
        if self._public_key_pem:
            from amtodo_crypto import seal

            envelope, data_key = seal(body, self._public_key_pem, "server-key-v1")
            body = envelope

        try:
            response = self._client.post(path, json=body)
            response.raise_for_status()
            resp_body = response.json()
            return _decrypt_response(resp_body, data_key)
        except httpx.HTTPStatusError as exc:
            return _error_from_response(exc, data_key)
        except httpx.RequestError as exc:
            return {"ok": False, "error": {"type": "ConnectionError", "message": str(exc)}}


def _error_from_response(
    exc: httpx.HTTPStatusError,
    data_key: bytes | None = None,
) -> dict[str, Any]:
    try:
        body = exc.response.json()
        return _decrypt_response(body, data_key)
    except Exception:
        return {"ok": False, "error": {"type": "HTTPError", "message": str(exc)}}


def _decrypt_response(body: dict[str, Any], data_key: bytes | None) -> dict[str, Any]:
    if data_key is None:
        return body
    from amtodo_crypto import is_response_envelope, open_response

    if is_response_envelope(body):
        try:
            return open_response(body, data_key)
        except Exception:
            return body
    return body
