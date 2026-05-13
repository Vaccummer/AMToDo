"""HTTP client wrapper for the AMToDo server API."""

from __future__ import annotations

from typing import Any

import httpx

from config import AppSettings


class AMTodoClient:
    """Thin HTTP client that mirrors the service API over REST."""

    def __init__(self, settings: AppSettings) -> None:
        self._base = settings.server_url.rstrip("/")
        self._admin_token = settings.admin_token
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if settings.access_token:
            headers["Authorization"] = f"Bearer {settings.access_token}"
        self._client = httpx.Client(base_url=self._base, headers=headers, timeout=30.0)

    def close(self) -> None:
        self._client.close()

    # ── admin ──

    def health(self) -> dict[str, Any]:
        return self._get("/api/v1/health")

    def init_db(self) -> dict[str, Any]:
        return self._post("/api/v1/admin/init-db", headers=self._admin_headers())

    def agent_guide(self) -> dict[str, Any]:
        return self._get("/api/v1/agent-guide")

    # ── user ──

    def user_me(self) -> dict[str, Any]:
        return self._get("/api/v1/user")

    # ── admin users ──

    def user_create(self, name: str) -> dict[str, Any]:
        return self._post("/api/v1/admin/users", json={"name": name}, headers=self._admin_headers())

    def user_list(self) -> dict[str, Any]:
        return self._get("/api/v1/admin/users", headers=self._admin_headers())

    def user_delete(self, user_id: int) -> dict[str, Any]:
        return self._delete(f"/api/v1/admin/users/{user_id}", headers=self._admin_headers())

    def user_update(self, user_id: int, name: str) -> dict[str, Any]:
        return self._patch(f"/api/v1/admin/users/{user_id}", json={"name": name}, headers=self._admin_headers())

    def user_regenerate_token(self, user_id: int) -> dict[str, Any]:
        return self._put(f"/api/v1/admin/users/{user_id}/token", headers=self._admin_headers())

    # ── todos ──

    def todo_add(
        self,
        title: str,
        due_at: int | None = None,
        description: str | None = None,
        priority: int = 0,
        tag: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "priority": priority}
        if due_at is not None:
            body["due_at"] = due_at
        if description is not None:
            body["description"] = description
        if tag is not None:
            body["tag"] = tag
        return self._post("/api/v1/todos", json=body)

    def todo_list(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
        open_only: bool = False,
        completed_only: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        if open_only:
            params["open_only"] = True
        if completed_only:
            params["completed_only"] = True
        return self._get("/api/v1/todos", params=params)

    def todo_search(
        self,
        pattern: str,
        start_at: int | None = None,
        end_at: int | None = None,
        ignore_case: bool = False,
        open_only: bool = False,
        completed_only: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"pattern": pattern}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        if ignore_case:
            params["ignore_case"] = True
        if open_only:
            params["open_only"] = True
        if completed_only:
            params["completed_only"] = True
        return self._get("/api/v1/todos/search", params=params)

    def todo_show(self, todo_id: int) -> dict[str, Any]:
        return self._get(f"/api/v1/todos/{todo_id}")

    def todo_update(self, todo_id: int, **fields: Any) -> dict[str, Any]:
        return self._patch(f"/api/v1/todos/{todo_id}", json=fields)

    def todo_done(self, targets: list[int]) -> dict[str, Any]:
        return self._post("/api/v1/todos/done", json={"targets": targets})

    def todo_reopen(self, targets: list[int]) -> dict[str, Any]:
        return self._post("/api/v1/todos/reopen", json={"targets": targets})

    def todo_remove(self, targets: list[int]) -> dict[str, Any]:
        return self._post("/api/v1/todos/remove", json={"targets": targets})

    def todo_stats(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        return self._get("/api/v1/todos/stats", params=params)

    # ── schedules ──

    def schedule_add(
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
        return self._post("/api/v1/schedules", json=body)

    def schedule_list(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        return self._get("/api/v1/schedules", params=params)

    def schedule_search(
        self,
        pattern: str,
        start_at: int | None = None,
        end_at: int | None = None,
        ignore_case: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"pattern": pattern}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        if ignore_case:
            params["ignore_case"] = True
        return self._get("/api/v1/schedules/search", params=params)

    def schedule_show(self, schedule_id: int) -> dict[str, Any]:
        return self._get(f"/api/v1/schedules/{schedule_id}")

    def schedule_update(self, schedule_id: int, **fields: Any) -> dict[str, Any]:
        return self._patch(f"/api/v1/schedules/{schedule_id}", json=fields)

    def schedule_remove(self, targets: list[int]) -> dict[str, Any]:
        return self._post("/api/v1/schedules/remove", json={"targets": targets})

    def schedule_conflicts(
        self,
        start_at: int,
        end_at: int,
        exclude_id: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"start_at": start_at, "end_at": end_at}
        if exclude_id is not None:
            params["exclude_id"] = exclude_id
        return self._get("/api/v1/schedules/conflicts", params=params)

    def schedule_stats(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if start_at is not None:
            params["start_at"] = start_at
        if end_at is not None:
            params["end_at"] = end_at
        return self._get("/api/v1/schedules/stats", params=params)

    # ── internal helpers ──

    def _admin_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._admin_token}"}

    def _get(self, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("GET", path, **kwargs)

    def _post(self, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("POST", path, **kwargs)

    def _put(self, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("PUT", path, **kwargs)

    def _delete(self, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("DELETE", path, **kwargs)

    def _patch(self, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("PATCH", path, **kwargs)

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            try:
                return exc.response.json()
            except Exception:
                return {
                    "ok": False,
                    "error": {"type": "HTTPError", "message": str(exc)},
                }
        except httpx.RequestError as exc:
            return {
                "ok": False,
                "error": {"type": "ConnectionError", "message": str(exc)},
            }
