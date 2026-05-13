"""Server API tests for schedule endpoints."""

from __future__ import annotations

import pytest

@pytest.fixture
def client(client_and_token):
    """Authed client for schedule tests."""
    c, _token = client_and_token
    return c


class TestCreateSchedule:
    def test_create_returns_schedule(self, client: AuthedClient):
        resp = client.post(
            "/api/v1/schedules",
            json={
                "title": "Meeting",
                "start_at": 1000,
                "end_at": 2000,
                "category": "work",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["schedule"]["title"] == "Meeting"
        assert data["schedule"]["category"] == "work"
        assert data["schedule"]["duration"] == 1000

    def test_create_rejects_invalid_window(self, client: AuthedClient):
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "Bad", "start_at": 2000, "end_at": 1000},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["type"] == "ValidationError"

    def test_create_rejects_conflict(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "First", "start_at": 1000, "end_at": 2000},
        )
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "Second", "start_at": 1500, "end_at": 2500},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["type"] == "ConflictError"


class TestListSchedules:
    def test_list_returns_schedules_in_range(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "In range", "start_at": 1000, "end_at": 2000},
        )
        resp = client.get("/api/v1/schedules", params={"start_at": 500, "end_at": 3000})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_list_excludes_out_of_range(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "Out of range", "start_at": 5000, "end_at": 6000},
        )
        resp = client.get("/api/v1/schedules", params={"start_at": 0, "end_at": 1000})
        assert resp.json()["count"] == 0


class TestShowSchedule:
    def test_show_returns_schedule(self, client: AuthedClient):
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "Find me", "start_at": 1000, "end_at": 2000},
        )
        sched_id = resp.json()["schedule"]["id"]
        resp = client.get(f"/api/v1/schedules/{sched_id}")
        assert resp.status_code == 200
        assert resp.json()["schedule"]["title"] == "Find me"

    def test_show_missing_returns_404(self, client: AuthedClient):
        resp = client.get("/api/v1/schedules/999")
        assert resp.status_code == 404


class TestUpdateSchedule:
    def test_update_changes_fields(self, client: AuthedClient):
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "Original", "start_at": 1000, "end_at": 2000},
        )
        sched_id = resp.json()["schedule"]["id"]
        resp = client.patch(
            f"/api/v1/schedules/{sched_id}",
            json={"title": "Updated", "location": "Room 1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["schedule"]["title"] == "Updated"
        assert data["schedule"]["location"] == "Room 1"

    def test_update_rejects_conflict(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "A", "start_at": 1000, "end_at": 2000},
        )
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "B", "start_at": 3000, "end_at": 4000},
        )
        sched_id = resp.json()["schedule"]["id"]
        resp = client.patch(
            f"/api/v1/schedules/{sched_id}",
            json={"start_at": 1500, "end_at": 2500},
        )
        assert resp.status_code == 409


class TestRemoveSchedule:
    def test_remove_deletes(self, client: AuthedClient):
        resp = client.post(
            "/api/v1/schedules",
            json={"title": "To delete", "start_at": 1000, "end_at": 2000},
        )
        sched_id = resp.json()["schedule"]["id"]
        resp = client.post("/api/v1/schedules/remove", json={"targets": [sched_id]})
        assert resp.json()["results"][0]["ok"] is True
        resp = client.get(f"/api/v1/schedules/{sched_id}")
        assert resp.status_code == 404


class TestConflicts:
    def test_conflicts_detects_overlap(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "Existing", "start_at": 1000, "end_at": 2000},
        )
        resp = client.get(
            "/api/v1/schedules/conflicts",
            params={"start_at": 1500, "end_at": 2500},
        )
        assert resp.json()["conflict"] is True
        assert resp.json()["count"] == 1

    def test_conflicts_excludes_id(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "Existing", "start_at": 1000, "end_at": 2000},
        )
        resp = client.get(
            "/api/v1/schedules/conflicts",
            params={"start_at": 1000, "end_at": 2000, "exclude_id": 1},
        )
        assert resp.json()["conflict"] is False


class TestScheduleStats:
    def test_stats_aggregates(self, client: AuthedClient):
        client.post(
            "/api/v1/schedules",
            json={"title": "A", "start_at": 1000, "end_at": 2000, "category": "work"},
        )
        client.post(
            "/api/v1/schedules",
            json={"title": "B", "start_at": 3000, "end_at": 5000, "category": "work"},
        )
        resp = client.get("/api/v1/schedules/stats")
        stats = resp.json()["stats"]
        assert stats["total"] == 2
        assert stats["total_duration"] == 1000 + 2000
        assert stats["by_category"]["work"]["count"] == 2
