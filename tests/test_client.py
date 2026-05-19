"""Tests for the HTTP client against a running server."""

from __future__ import annotations

import secrets

import httpx
import pytest
from fastapi.testclient import TestClient

from client.http import AMTodoClient
from clock import SystemClock
from config import AppSettings
from models.factory import get_user_tables
from models.user import User
from server.app import create_app


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "test.sqlite3"
    settings = AppSettings(
        database_url=f"sqlite:///{db_path}",
        admin_token="admin-secret",
    )
    app = create_app(settings)

    token = secrets.token_urlsafe(32)
    clock = SystemClock()

    with TestClient(app, client=("127.0.0.1", 50000)) as test_client:
        # lifespan has run, db and token_map are now on app.state
        db = app.state.db
        token_map: dict[str, int] = app.state.token_map

        with db.session() as session:
            user = User(
                name="test",
                token=token,
                created_at=clock.now_epoch(),
            )
            session.add(user)
            session.commit()
            user_id = user.id

        token_map[token] = user_id
        get_user_tables(user_id)
        db.create_schema()

        class TestTransport(httpx.BaseTransport):
            def handle_request(self, request):
                headers = dict(request.headers)
                path = request.url.path
                if request.url.query:
                    path += "?" + request.url.query.decode()
                test_resp = test_client.request(
                    method=request.method,
                    url=path,
                    headers=headers,
                    content=request.read(),
                )
                return httpx.Response(
                    status_code=test_resp.status_code,
                    headers=dict(test_resp.headers),
                    content=test_resp.content,
                    request=request,
                )

        client_settings = AppSettings(
            database_url=f"sqlite:///{db_path}",
            server_url="http://testserver",
            access_token=token,
            admin_token="admin-secret",
        )
        c = AMTodoClient(client_settings)
        c._client = httpx.Client(
            transport=TestTransport(),
            base_url="http://testserver",
        )
        yield c
        c.close()


class TestTodoClient:
    def test_add_and_show(self, client):
        result = client.todo_create(title="Hello", priority=2)
        assert result["ok"] is True
        todo_id = result["todo"]["id"]
        assert todo_id == 1

        result = client.todo_get(todo_id)
        assert result["todo"]["title"] == "Hello"
        assert result["todo"]["priority"] == 2

    def test_list(self, client):
        client.todo_create(title="A")
        client.todo_create(title="B")
        result = client.todo_list(open_only=True)
        assert result["count"] == 2

    def test_search(self, client):
        client.todo_create(title="Buy milk")
        client.todo_create(title="Read book")
        result = client.todo_search("milk")
        assert result["count"] == 1
        assert result["query"] == "milk"
        assert result["use_regex"] is False

        literal = client.todo_search("milk|book")
        regex = client.todo_search("milk|book", use_regex=True)
        assert literal["count"] == 0
        assert regex["total"] == 2

        paged = client.todo_search("", sort_by="created_at", sort_order="asc", limit=1)
        assert paged["count"] == 1
        assert paged["total"] == 2
        assert paged["pagination"]["has_more"] is True

    def test_update(self, client):
        client.todo_create(title="Old")
        result = client.todo_update(1, title="New", priority=9)
        assert result["todo"]["title"] == "New"
        assert result["todo"]["priority"] == 9

    def test_done_and_reopen(self, client):
        client.todo_create(title="Task")
        result = client.todo_done([1])
        assert result["results"][0]["todo"]["completed"] is True

        result = client.todo_reopen([1])
        assert result["results"][0]["todo"]["completed"] is False

    def test_remove(self, client):
        client.todo_create(title="To delete")
        result = client.todo_remove([1])
        assert result["results"][0]["ok"] is True

        result = client.todo_get(1)
        assert result["ok"] is False

    def test_stats(self, client):
        client.todo_create(title="Work 1", tag="work")
        client.todo_create(title="Work 2", tag="work")
        client.todo_create(title="Home 1", tag="home")
        result = client.todo_stats()
        assert result["stats"]["total"] == 3
        assert result["stats"]["by_tag"]["work"] == 2
        assert result["stats"]["by_tag"]["home"] == 1

    def test_not_found_returns_error(self, client):
        result = client.todo_get(99999)
        assert result["ok"] is False
        assert result["error"]["type"] == "NotFoundError"

    def test_batch_create(self, client):
        result = client.todo_batch_create([
            {"title": "Batch 1", "priority": 1},
            {"title": "Batch 2", "tag": "work"},
        ])
        assert result["ok"] is True
        assert len(result["results"]) == 2
        assert result["results"][0]["ok"] is True
        assert result["results"][0]["todo"]["title"] == "Batch 1"
        assert result["results"][1]["ok"] is True
        assert result["results"][1]["todo"]["tag"] == "work"

    def test_batch_create_partial_failure(self, client):
        result = client.todo_batch_create([
            {"title": "Valid"},
            {"title": "   "},  # empty title -> ValidationError
        ])
        assert result["ok"] is False
        assert result["results"][0]["ok"] is True
        assert result["results"][1]["ok"] is False
        assert result["results"][1]["error"]["type"] == "ValidationError"

    def test_batch_update(self, client):
        client.todo_create(title="Original 1")
        client.todo_create(title="Original 2")
        result = client.todo_batch_update([
            {"id": 1, "title": "Updated 1"},
            {"id": 2, "priority": 5},
        ])
        assert result["ok"] is True
        assert result["results"][0]["todo"]["title"] == "Updated 1"
        assert result["results"][1]["todo"]["priority"] == 5

    def test_batch_update_partial_failure(self, client):
        client.todo_create(title="Exists")
        result = client.todo_batch_update([
            {"id": 1, "title": "Updated"},
            {"id": 999, "title": "Missing"},  # NotFoundError
        ])
        assert result["ok"] is False
        assert result["results"][0]["ok"] is True
        assert result["results"][1]["ok"] is False
        assert result["results"][1]["error"]["type"] == "NotFoundError"

    def test_trash_flow(self, client):
        client.todo_create(title="To trash")
        result = client.todo_remove([1])
        assert result["ok"] is True
        assert result["results"][0]["todo"]["deleted_at"] is not None

        # Not visible in normal list
        result = client.todo_list()
        assert result["count"] == 0

        # Visible in trash
        result = client.todo_trash_list()
        assert result["count"] == 1

        # Restore
        result = client.todo_trash_restore([1])
        assert result["ok"] is True
        result = client.todo_list()
        assert result["count"] == 1

    def test_trash_purge(self, client):
        client.todo_create(title="To purge")
        client.todo_remove([1])
        result = client.todo_trash_delete([1])
        assert result["ok"] is True

        result = client.todo_trash_list()
        assert result["count"] == 0


class TestScheduleClient:
    def test_add_and_list(self, client):
        result = client.schedule_create(title="Meeting", start_at=1000, end_at=2000, category="work")
        assert result["ok"] is True
        assert result["schedule"]["id"] == 1

        result = client.schedule_list(start_at=0, end_at=5000)
        assert result["count"] == 1

    def test_conflicts(self, client):
        client.schedule_create(title="Existing", start_at=1000, end_at=2000)
        result = client.schedule_conflicts(start_at=1500, end_at=2500)
        assert result["conflict"] is True

    def test_update_and_remove(self, client):
        client.schedule_create(title="Original", start_at=1000, end_at=2000)
        result = client.schedule_update(1, title="Updated", location="Office")
        assert result["schedule"]["title"] == "Updated"
        assert result["schedule"]["location"] == "Office"

        result = client.schedule_remove([1])
        assert result["results"][0]["ok"] is True

    def test_stats(self, client):
        client.schedule_create(title="A", start_at=1000, end_at=2000, category="work")
        client.schedule_create(title="B", start_at=3000, end_at=5000, category="personal")
        result = client.schedule_stats()
        assert result["stats"]["total"] == 2

    def test_batch_create(self, client):
        result = client.schedule_batch_create([
            {"title": "Batch A", "start_at": 1000, "end_at": 2000},
            {"title": "Batch B", "start_at": 3000, "end_at": 4000, "category": "work"},
        ])
        assert result["ok"] is True
        assert len(result["results"]) == 2
        assert result["results"][0]["ok"] is True
        assert result["results"][1]["schedule"]["category"] == "work"

    def test_batch_create_partial_failure(self, client):
        client.schedule_create(title="Existing", start_at=1000, end_at=2000)
        result = client.schedule_batch_create([
            {"title": "Valid", "start_at": 5000, "end_at": 6000},
            {"title": "Conflict", "start_at": 1500, "end_at": 1800},  # ConflictError
        ])
        assert result["ok"] is False
        assert result["results"][0]["ok"] is True
        assert result["results"][1]["ok"] is False
        assert result["results"][1]["error"]["type"] == "ConflictError"

    def test_batch_update(self, client):
        client.schedule_create(title="A", start_at=1000, end_at=2000)
        client.schedule_create(title="B", start_at=3000, end_at=4000)
        result = client.schedule_batch_update([
            {"id": 1, "title": "A updated"},
            {"id": 2, "location": "Room 101"},
        ])
        assert result["ok"] is True
        assert result["results"][0]["schedule"]["title"] == "A updated"
        assert result["results"][1]["schedule"]["location"] == "Room 101"

    def test_trash_flow(self, client):
        client.schedule_create(title="To trash", start_at=1000, end_at=2000)
        result = client.schedule_remove([1])
        assert result["ok"] is True

        result = client.schedule_trash_list()
        assert result["count"] == 1

        result = client.schedule_trash_restore([1])
        assert result["ok"] is True

        result = client.schedule_list(start_at=0, end_at=5000)
        assert result["count"] == 1

    def test_trash_purge(self, client):
        client.schedule_create(title="To purge", start_at=1000, end_at=2000)
        client.schedule_remove([1])
        result = client.schedule_trash_delete([1])
        assert result["ok"] is True

        result = client.schedule_trash_list()
        assert result["count"] == 0


class TestAdminClient:
    def test_health(self, client):
        result = client.health()
        assert result["status"] == "ok"
        assert "version" in result

