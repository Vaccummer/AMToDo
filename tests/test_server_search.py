"""Server-level search endpoint tests."""

from __future__ import annotations

import secrets
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from clock import FixedClock
from config import AppSettings
from models.factory import get_user_tables
from models.user import User
from server.app import create_app
from server.deps import get_clock


class ServerHarness:
    def __init__(self, client: TestClient, token: str, clock_state: dict[str, int]) -> None:
        self._client = client
        self._token = token
        self._clock_state = clock_state

    def set_clock(self, epoch: int) -> None:
        self._clock_state["epoch"] = epoch

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.response(path, body)
        assert response.status_code == 200, response.text
        return response.json()

    def response(self, path: str, body: dict[str, Any]) -> httpx.Response:
        return self._client.post(
            path,
            json={"access_token": self._token, **body},
        )


@pytest.fixture
def server(tmp_path: Path) -> Iterator[ServerHarness]:
    db_path = tmp_path / "test.sqlite3"
    settings = AppSettings(
        database_url=f"sqlite:///{db_path}",
        admin_token="admin-secret",
    )
    app = create_app(settings)
    clock_state = {"epoch": 1_778_400_000}
    app.dependency_overrides[get_clock] = lambda: FixedClock(clock_state["epoch"])

    token = secrets.token_urlsafe(32)
    with TestClient(app) as test_client:
        db = app.state.db
        with db.session() as session:
            user = User(
                name="server-search-test",
                token=token,
                created_at=clock_state["epoch"],
            )
            session.add(user)
            session.commit()
            user_id = user.id

        app.state.token_map[token] = user_id
        get_user_tables(user_id)
        db.create_schema()

        yield ServerHarness(test_client, token, clock_state)

    app.dependency_overrides.clear()


def test_todo_search_endpoint_options(server: ServerHarness) -> None:
    base = 1_778_400_000
    seed = [
        (
            base,
            {
                "title": "Alpha Plan",
                "description": "Release notes",
                "planned_at": 1_000,
                "due_at": 5_000,
                "priority": 1,
                "tag": "work",
            },
        ),
        (
            base + 100,
            {
                "title": "Beta Review",
                "description": "Contains Needle",
                "planned_at": 2_000,
                "due_at": 6_000,
                "priority": 5,
                "tag": "work",
            },
        ),
        (
            base + 200,
            {
                "title": "gamma Errand",
                "description": "Pickup",
                "planned_at": 3_000,
                "due_at": 7_000,
                "priority": 3,
                "tag": "home",
            },
        ),
        (
            base + 300,
            {
                "title": "Delta Done",
                "description": "Shared archive",
                "planned_at": 4_000,
                "due_at": 8_000,
                "priority": 4,
                "tag": "work",
            },
        ),
    ]
    ids: dict[str, int] = {}
    for clock, payload in seed:
        server.set_clock(clock)
        result = server.post("/api/v1/todos/create", payload)
        ids[payload["title"]] = result["todo"]["id"]

    server.set_clock(base + 400)
    server.post("/api/v1/todos/done", {"targets": [ids["Delta Done"]]})
    server.set_clock(base + 500)
    server.post(
        "/api/v1/todos/update",
        {
            "todo_id": ids["Beta Review"],
            "description": "Contains Needle after update",
        },
    )

    text = server.post("/api/v1/todos/search", {"query": "Needle"})
    assert [todo["id"] for todo in text["todos"]] == [ids["Beta Review"]]

    literal = server.post("/api/v1/todos/search", {"query": "Alpha|gamma"})
    regex = server.post(
        "/api/v1/todos/search",
        {"query": "Alpha|gamma", "use_regex": True},
    )
    assert literal["total"] == 0
    assert {todo["id"] for todo in regex["todos"]} == {
        ids["Alpha Plan"],
        ids["gamma Errand"],
    }

    case_sensitive = server.post(
        "/api/v1/todos/search",
        {"query": "GAMMA", "fields": ["title"], "ignore_case": False},
    )
    case_insensitive = server.post(
        "/api/v1/todos/search",
        {"query": "GAMMA", "fields": ["title"]},
    )
    assert case_sensitive["total"] == 0
    assert [todo["id"] for todo in case_insensitive["todos"]] == [ids["gamma Errand"]]

    field_limited = server.post(
        "/api/v1/todos/search",
        {"query": "Needle", "fields": ["title"]},
    )
    assert field_limited["total"] == 0

    planned_aliases = server.post(
        "/api/v1/todos/search",
        {"query": "", "start_at": 1_900, "end_at": 2_500},
    )
    assert [todo["id"] for todo in planned_aliases["todos"]] == [ids["Beta Review"]]
    assert planned_aliases["range"]["planned_start_at"] == 1_900
    assert planned_aliases["range"]["planned_end_at"] == 2_500

    explicit_planned = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "start_at": 0,
            "end_at": 10_000,
            "planned_start_at": 3_900,
            "planned_end_at": 4_100,
        },
    )
    assert [todo["id"] for todo in explicit_planned["todos"]] == [ids["Delta Done"]]

    due_range = server.post(
        "/api/v1/todos/search",
        {"query": "", "due_start_at": 5_900, "due_end_at": 6_100},
    )
    assert [todo["id"] for todo in due_range["todos"]] == [ids["Beta Review"]]

    created_range = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "created_start_at": base + 50,
            "created_end_at": base + 150,
        },
    )
    assert [todo["id"] for todo in created_range["todos"]] == [ids["Beta Review"]]

    updated_range = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "updated_start_at": base + 450,
            "updated_end_at": base + 550,
        },
    )
    assert [todo["id"] for todo in updated_range["todos"]] == [ids["Beta Review"]]

    completed = server.post("/api/v1/todos/search", {"query": "", "completed": True})
    open_only = server.post("/api/v1/todos/search", {"query": "", "open_only": True})
    completed_only = server.post(
        "/api/v1/todos/search",
        {"query": "", "completed_only": True},
    )
    assert [todo["id"] for todo in completed["todos"]] == [ids["Delta Done"]]
    assert {todo["id"] for todo in open_only["todos"]} == {
        ids["Alpha Plan"],
        ids["Beta Review"],
        ids["gamma Errand"],
    }
    assert [todo["id"] for todo in completed_only["todos"]] == [ids["Delta Done"]]

    scalar_filters = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "completed": False,
            "priority_min": 4,
            "priority_max": 5,
            "tag": "work",
        },
    )
    assert [todo["id"] for todo in scalar_filters["todos"]] == [ids["Beta Review"]]
    assert scalar_filters["filter"] == {
        "completed": False,
        "priority_min": 4,
        "priority_max": 5,
        "tag": "work",
    }

    page1 = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "sort_by": "priority",
            "sort_order": "desc",
            "limit": 2,
        },
    )
    assert len(page1["todos"]) == 2
    assert page1["sort"] == {"by": "priority", "order": "desc"}
    assert page1["pagination"]["limit"] == 2

    page2 = server.post(
        "/api/v1/todos/search",
        {
            "query": "",
            "sort_by": "priority",
            "sort_order": "desc",
            "limit": 2,
            "after_id": page1["pagination"]["next_cursor"],
        },
    )
    page1_ids = [todo["id"] for todo in page1["todos"]]
    page2_ids = [todo["id"] for todo in page2["todos"]]
    assert page1_ids != page2_ids
    assert len(set(page1_ids) & set(page2_ids)) == 0

    bad_regex = server.response(
        "/api/v1/todos/search",
        {"query": "[", "use_regex": True},
    )
    assert bad_regex.status_code == 400
    assert bad_regex.json()["error"]["type"] == "ValidationError"

    conflicting_completion = server.response(
        "/api/v1/todos/search",
        {"query": "", "completed": True, "open_only": True},
    )
    assert conflicting_completion.status_code == 400


def test_schedule_search_endpoint_options(server: ServerHarness) -> None:
    base = 1_778_400_000
    seed = [
        (
            base,
            {
                "title": "Alpha Workshop",
                "description": "Deep focus",
                "start_at": 1_000,
                "end_at": 1_100,
                "location": "Room A",
                "category": "work",
            },
        ),
        (
            base + 100,
            {
                "title": "Beta Sync",
                "description": "Needle notes",
                "start_at": 2_000,
                "end_at": 2_300,
                "location": "Room B",
                "category": "work",
            },
        ),
        (
            base + 200,
            {
                "title": "gamma Lunch",
                "description": "Casual",
                "start_at": 3_000,
                "end_at": 3_600,
                "location": "Cafe",
                "category": "personal",
            },
        ),
    ]
    ids: dict[str, int] = {}
    for clock, payload in seed:
        server.set_clock(clock)
        result = server.post("/api/v1/schedules/create", payload)
        ids[payload["title"]] = result["schedule"]["id"]

    server.set_clock(base + 300)
    server.post(
        "/api/v1/schedules/update",
        {
            "schedule_id": ids["Beta Sync"],
            "description": "Needle notes after update",
        },
    )

    text = server.post("/api/v1/schedules/search", {"query": "Needle"})
    assert [schedule["id"] for schedule in text["schedules"]] == [ids["Beta Sync"]]

    literal = server.post("/api/v1/schedules/search", {"query": "Workshop|Lunch"})
    regex = server.post(
        "/api/v1/schedules/search",
        {"query": "Workshop|Lunch", "use_regex": True},
    )
    assert literal["total"] == 0
    assert {schedule["id"] for schedule in regex["schedules"]} == {
        ids["Alpha Workshop"],
        ids["gamma Lunch"],
    }

    case_sensitive = server.post(
        "/api/v1/schedules/search",
        {"query": "GAMMA", "fields": ["title"], "ignore_case": False},
    )
    case_insensitive = server.post(
        "/api/v1/schedules/search",
        {"query": "GAMMA", "fields": ["title"]},
    )
    assert case_sensitive["total"] == 0
    assert [schedule["id"] for schedule in case_insensitive["schedules"]] == [
        ids["gamma Lunch"]
    ]

    field_limited = server.post(
        "/api/v1/schedules/search",
        {"query": "Room B", "fields": ["location"]},
    )
    wrong_field = server.post(
        "/api/v1/schedules/search",
        {"query": "Room B", "fields": ["title"]},
    )
    assert [schedule["id"] for schedule in field_limited["schedules"]] == [ids["Beta Sync"]]
    assert wrong_field["total"] == 0

    overlap = server.post(
        "/api/v1/schedules/search",
        {
            "query": "",
            "start_at": 1_050,
            "end_at": 2_050,
            "sort_by": "start_at",
            "sort_order": "asc",
        },
    )
    assert [schedule["id"] for schedule in overlap["schedules"]] == [
        ids["Alpha Workshop"],
        ids["Beta Sync"],
    ]
    assert overlap["range"]["start_at"] == 1_050
    assert overlap["range"]["end_at"] == 2_050

    created_range = server.post(
        "/api/v1/schedules/search",
        {
            "query": "",
            "created_start_at": base + 50,
            "created_end_at": base + 150,
        },
    )
    assert [schedule["id"] for schedule in created_range["schedules"]] == [
        ids["Beta Sync"]
    ]

    updated_range = server.post(
        "/api/v1/schedules/search",
        {
            "query": "",
            "updated_start_at": base + 250,
            "updated_end_at": base + 350,
        },
    )
    assert [schedule["id"] for schedule in updated_range["schedules"]] == [
        ids["Beta Sync"]
    ]

    scalar_filters = server.post(
        "/api/v1/schedules/search",
        {"query": "", "category": "work", "location": "Room B"},
    )
    assert [schedule["id"] for schedule in scalar_filters["schedules"]] == [
        ids["Beta Sync"]
    ]
    assert scalar_filters["filter"] == {"category": "work", "location": "Room B"}

    page1 = server.post(
        "/api/v1/schedules/search",
        {
            "query": "",
            "sort_by": "duration",
            "sort_order": "desc",
            "limit": 1,
        },
    )
    assert len(page1["schedules"]) == 1
    assert page1["sort"] == {"by": "duration", "order": "desc"}
    assert page1["pagination"]["limit"] == 1

    page2 = server.post(
        "/api/v1/schedules/search",
        {
            "query": "",
            "sort_by": "duration",
            "sort_order": "desc",
            "limit": 1,
            "after_id": page1["pagination"]["next_cursor"],
        },
    )
    assert len(page2["schedules"]) == 1
    assert page1["schedules"][0]["id"] != page2["schedules"][0]["id"]

    bad_field = server.response(
        "/api/v1/schedules/search",
        {"query": "", "fields": ["title", "unknown"]},
    )
    assert bad_field.status_code == 400
    assert bad_field.json()["error"]["type"] == "ValidationError"
