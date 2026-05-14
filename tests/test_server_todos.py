"""Server API tests for todo endpoints."""

from __future__ import annotations

import pytest

@pytest.fixture
def client(client_and_token):
    """Authed client for todo tests."""
    c, _token = client_and_token
    return c


class TestCreateTodo:
    def test_create_returns_todo(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "Buy milk", "priority": 1})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["todo"]["title"] == "Buy milk"
        assert data["todo"]["priority"] == 1
        assert data["todo"]["completed"] is False
        assert data["todo"]["id"] == 1

    def test_create_due_at_defaults_to_none(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "test"})
        assert resp.status_code == 200
        assert resp.json()["todo"]["due_at"] is None
        assert resp.json()["todo"]["planned_at"] is not None

    def test_create_rejects_empty_title(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "  "})
        assert resp.status_code == 400
        assert resp.json()["ok"] is False
        assert resp.json()["error"]["type"] == "ValidationError"

    def test_create_rejects_negative_priority(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "test", "priority": -1})
        assert resp.status_code == 422  # Pydantic validation


class TestListTodos:
    def test_list_returns_empty(self, client: AuthedClient):
        resp = client.get("/api/v1/todos")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["count"] == 0
        assert data["todos"] == []

    def test_list_returns_created_todos(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "First"})
        client.post("/api/v1/todos", json={"title": "Second"})
        resp = client.get("/api/v1/todos")
        assert resp.status_code == 200
        assert resp.json()["count"] == 2

    def test_list_filters_by_completion(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "Open"})
        resp = client.post("/api/v1/todos", json={"title": "Done"})
        todo_id = resp.json()["todo"]["id"]
        client.post("/api/v1/todos/done", json={"targets": [todo_id]})

        open_resp = client.get("/api/v1/todos", params={"open_only": True})
        assert open_resp.json()["count"] == 1
        assert open_resp.json()["todos"][0]["title"] == "Open"

        completed_resp = client.get("/api/v1/todos", params={"completed_only": True})
        assert completed_resp.json()["count"] == 1
        assert completed_resp.json()["todos"][0]["title"] == "Done"

    def test_list_filters_by_planned_range(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "Today", "planned_at": 100})
        client.post("/api/v1/todos", json={"title": "Tomorrow", "planned_at": 200})

        resp = client.get("/api/v1/todos", params={"start_at": 150, "end_at": 250})

        assert resp.status_code == 200
        assert [todo["title"] for todo in resp.json()["todos"]] == ["Tomorrow"]


class TestShowTodo:
    def test_show_returns_todo(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "Find me"})
        todo_id = resp.json()["todo"]["id"]
        resp = client.get(f"/api/v1/todos/{todo_id}")
        assert resp.status_code == 200
        assert resp.json()["todo"]["title"] == "Find me"

    def test_show_missing_returns_404(self, client: AuthedClient):
        resp = client.get("/api/v1/todos/999")
        assert resp.status_code == 404
        assert resp.json()["error"]["type"] == "NotFoundError"


class TestUpdateTodo:
    def test_update_changes_fields(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "Original"})
        todo_id = resp.json()["todo"]["id"]
        resp = client.patch(
            f"/api/v1/todos/{todo_id}",
            json={"title": "Updated", "priority": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["todo"]["title"] == "Updated"
        assert data["todo"]["priority"] == 5

    def test_update_missing_returns_404(self, client: AuthedClient):
        resp = client.patch("/api/v1/todos/999", json={"title": "Nope"})
        assert resp.status_code == 404


class TestDoneReopen:
    def test_done_marks_completed(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "To complete"})
        todo_id = resp.json()["todo"]["id"]
        resp = client.post("/api/v1/todos/done", json={"targets": [todo_id]})
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["ok"] is True
        assert result["todo"]["completed"] is True
        assert result["todo"]["completed_at"] is not None

    def test_done_missing_returns_error_per_target(self, client: AuthedClient):
        resp = client.post("/api/v1/todos/done", json={"targets": [999]})
        assert resp.status_code == 200
        assert resp.json()["ok"] is False
        assert resp.json()["results"][0]["ok"] is False

    def test_reopen_marks_open(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "To reopen"})
        todo_id = resp.json()["todo"]["id"]
        client.post("/api/v1/todos/done", json={"targets": [todo_id]})
        resp = client.post("/api/v1/todos/reopen", json={"targets": [todo_id]})
        assert resp.json()["results"][0]["todo"]["completed"] is False

    def test_done_bulk_multiple_targets(self, client: AuthedClient):
        r1 = client.post("/api/v1/todos", json={"title": "A"})
        r2 = client.post("/api/v1/todos", json={"title": "B"})
        ids = [r1.json()["todo"]["id"], r2.json()["todo"]["id"]]
        resp = client.post("/api/v1/todos/done", json={"targets": ids})
        assert resp.json()["ok"] is True
        assert len(resp.json()["results"]) == 2


class TestRemoveTodo:
    def test_remove_deletes(self, client: AuthedClient):
        resp = client.post("/api/v1/todos", json={"title": "To delete"})
        todo_id = resp.json()["todo"]["id"]
        resp = client.post("/api/v1/todos/remove", json={"targets": [todo_id]})
        assert resp.json()["results"][0]["ok"] is True
        resp = client.get(f"/api/v1/todos/{todo_id}")
        assert resp.status_code == 404


class TestSearchTodos:
    def test_search_finds_matching_todo(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "Buy groceries"})
        client.post("/api/v1/todos", json={"title": "Read book"})
        resp = client.get("/api/v1/todos/search", params={"pattern": "groceries"})
        assert resp.json()["count"] == 1

    def test_search_case_insensitive(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "UPPERCASE"})
        resp = client.get(
            "/api/v1/todos/search",
            params={"pattern": "uppercase", "ignore_case": True},
        )
        assert resp.json()["count"] == 1

    def test_search_filters_by_planned_and_created_ranges(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "Shared old", "planned_at": 100})
        client.post("/api/v1/todos", json={"title": "Shared new", "planned_at": 200})
        resp = client.get(
            "/api/v1/todos/search",
            params={
                "pattern": "Shared",
                "planned_start_at": 150,
                "planned_end_at": 250,
                "created_start_at": 0,
                "created_end_at": 9_999_999_999,
            },
        )

        assert resp.status_code == 200
        assert [todo["title"] for todo in resp.json()["todos"]] == ["Shared new"]

    def test_search_invalid_regex_returns_400(self, client: AuthedClient):
        resp = client.get("/api/v1/todos/search", params={"pattern": "["})
        assert resp.status_code == 400


class TestTodoStats:
    def test_stats_counts_correctly(self, client: AuthedClient):
        client.post("/api/v1/todos", json={"title": "One", "tag": "work"})
        client.post("/api/v1/todos", json={"title": "Two", "tag": "work"})
        client.post("/api/v1/todos", json={"title": "Three", "tag": "home"})
        resp = client.get("/api/v1/todos/stats")
        assert resp.json()["stats"]["total"] == 3
        assert resp.json()["stats"]["open"] == 3
        assert resp.json()["stats"]["completed"] == 0
        assert resp.json()["stats"]["by_tag"]["work"] == 2
        assert resp.json()["stats"]["by_tag"]["home"] == 1
