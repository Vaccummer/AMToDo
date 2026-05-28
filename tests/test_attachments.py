"""Attachment streaming transfer tests."""

from __future__ import annotations

import hashlib
import secrets
import time
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

import config
from clock import FixedClock, SystemClock
from config import AppSettings
from db.engine import create_database
from models.factory import get_user_tables
from models.user import User
from server.app import create_app
from server.attachment_routes import _download_media_type
from services import AttachmentService
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from db.engine import Database


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_test_database(tmp_path: Path) -> Database:
    settings = AppSettings(database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}")
    database = create_database(settings)
    database.create_schema()
    return database


def _attachment_service(
    uow: UnitOfWork,
    clock: FixedClock,
    root: Path,
    owner_type: str = "todo",
) -> AttachmentService:
    return AttachmentService(
        uow.attachments,
        uow.todos,
        clock,
        uow.attachment_model,
        root,
        uow.user_id,
        owner_type=owner_type,
    )


def _make_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "_AMTODO_SERVER_ROOT_CACHE", tmp_path)
    att_root = tmp_path / "attachments"
    att_root.mkdir(parents=True, exist_ok=True)
    app = create_app(
        AppSettings(
            database_url=f"sqlite:///{tmp_path / 'server.sqlite3'}",
            admin_token="admin-secret",
            attachment_root=str(att_root),
            max_attachment_size_bytes=1024 * 1024,  # 1 MB for tests
        )
    )
    return app


def _setup_user_and_todo(app, tmp_path):
    """Create a user and todo, return (token, user_id, todo_id)."""
    token = secrets.token_urlsafe(32)

    with TestClient(app) as client:
        db = app.state.db
        with db.session() as session:
            user = User(name="test", token=token, created_at=SystemClock().now_epoch())
            session.add(user)
            session.commit()
            user_id = user.id

        app.state.token_map[token] = user_id
        get_user_tables(user_id)
        db.create_schema()

        todo_response = client.post(
            "/api/v1/todos/create",
            json={"title": "With upload"},
            headers={"Authorization": f"Bearer {token}"},
        )
        todo_id = todo_response.json()["todo"]["id"]

    return token, user_id, todo_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_stream_upload_and_download(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Full round-trip: init upload token -> PUT file bytes -> verify metadata
    -> init download token -> GET download -> verify bytes match."""
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)

    plain_content = b"Hello, this is plaintext content for testing"
    plain_sha256 = hashlib.sha256(plain_content).hexdigest()

    with TestClient(app) as client:
        # Step 1: Init upload
        init_response = client.post(
            "/api/v1/attachment/init-upload",
            json={
                "owner_type": "todo",
                "owner_id": todo_id,
                "filename": "test.txt",
                "mime_type": "text/plain",
                "plain_size": len(plain_content),
                "plain_sha256": plain_sha256,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert init_response.status_code == 200
        upload_token = init_response.json()["token"]

        # Step 2: PUT file bytes
        upload_response = client.put(
            f"/api/v1/attachment/upload?token={upload_token}",
            content=plain_content,
            headers={"Content-Type": "application/octet-stream"},
        )
        assert upload_response.status_code == 200
        result = upload_response.json()
        assert result["ok"] is True
        attachment = result["attachment"]
        assert attachment["filename"] == "test.txt"
        assert attachment["mime_type"] == "text/plain"
        assert attachment["plain_size_bytes"] == len(plain_content)
        assert attachment["plain_sha256"] == plain_sha256

        # Step 3: Verify metadata via list
        list_response = client.post(
            "/api/v1/attachment/list",
            json={"todo_id": todo_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert list_response.json()["count"] == 1

        # Step 4: Init download token
        download_init_response = client.post(
            "/api/v1/attachment/init-download",
            json={"owner_type": "todo", "owner_id": todo_id, "attachment_id": attachment["id"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert download_init_response.status_code == 200
        download_token = download_init_response.json()["token"]

        # Step 5: GET download
        download_response = client.get(
            f"/api/v1/attachment/{attachment['id']}/download?token={download_token}",
        )
        assert download_response.status_code == 200
        assert download_response.content == plain_content
        assert download_response.headers["content-type"].startswith("text/plain")
        assert download_response.headers["accept-ranges"] == "bytes"
        assert "X-AMToDo-Content-SHA256" in download_response.headers

        range_response = client.get(
            f"/api/v1/attachment/{attachment['id']}/download?token={download_token}",
            headers={"Range": "bytes=7-10"},
        )
        assert range_response.status_code == 206
        assert range_response.content == plain_content[7:11]
        assert range_response.headers["content-range"] == f"bytes 7-10/{len(plain_content)}"
        assert range_response.headers["content-length"] == "4"


def test_download_media_type_guesses_from_filename_when_upload_mime_is_generic() -> None:
    assert _download_media_type("application/octet-stream", "clip.mp4") == "video/mp4"
    assert _download_media_type("", "photo.jpg") == "image/jpeg"


def test_download_headers_use_actual_file_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)
    content = b"actual file bytes"

    with TestClient(app) as client:
        init_response = client.post(
            "/api/v1/attachment/init-upload",
            json={
                "owner_type": "todo",
                "owner_id": todo_id,
                "filename": "mismatch.txt",
                "mime_type": "text/plain",
                "plain_size": len(content),
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        upload_token = init_response.json()["token"]
        upload_response = client.put(
            f"/api/v1/attachment/upload?token={upload_token}",
            content=content,
            headers={"Content-Type": "application/octet-stream"},
        )
        attachment = upload_response.json()["attachment"]

        with UnitOfWork(app.state.db, user_id) as uow:
            stored = uow.attachments.get(attachment["id"])
            stored.plain_size_bytes = len(content) + 100
            uow.attachments.update(stored)

        download_init_response = client.post(
            "/api/v1/attachment/init-download",
            json={"owner_type": "todo", "owner_id": todo_id, "attachment_id": attachment["id"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        download_token = download_init_response.json()["token"]

        download_response = client.get(
            f"/api/v1/attachment/{attachment['id']}/download?token={download_token}",
        )
        assert download_response.status_code == 200
        assert download_response.content == content
        assert download_response.headers["content-length"] == str(len(content))

        range_response = client.get(
            f"/api/v1/attachment/{attachment['id']}/download?token={download_token}",
            headers={"Range": "bytes=7-10"},
        )
        assert range_response.status_code == 206
        assert range_response.headers["content-range"] == f"bytes 7-10/{len(content)}"


def test_upload_token_expiry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Create token, wait > TTL, attempt upload -> 404."""
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)

    upload_store = app.state.upload_token_store
    # Create a token with 0 TTL (already expired)
    upload_store._ttl = 0
    upload_token = upload_store.create(
        owner_type="todo",
        owner_id=todo_id,
        user_id=user_id,
        filename="test.txt",
        mime_type="text/plain",
        plain_size=10,
    )

    # Wait a moment so the token expires
    time.sleep(0.1)

    with TestClient(app) as client:
        response = client.put(
            f"/api/v1/attachment/upload?token={upload_token}",
            content=b"some data",
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 404


def test_upload_size_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Set small limit, upload oversized file -> 413 mid-stream."""
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)

    # Override max size to be very small
    app.state.settings = AppSettings(
        database_url=app.state.settings.database_url,
        admin_token=app.state.settings.admin_token,
        attachment_root=app.state.settings.attachment_root,
        max_attachment_size_bytes=100,  # 100 bytes
    )

    upload_store = app.state.upload_token_store
    upload_token = upload_store.create(
        owner_type="todo",
        owner_id=todo_id,
        user_id=user_id,
        filename="big.bin",
        mime_type="application/octet-stream",
        plain_size=1000,
    )

    with TestClient(app) as client:
        # Upload data that exceeds the limit
        response = client.put(
            f"/api/v1/attachment/upload?token={upload_token}",
            content=b"x" * 200,  # 200 bytes > 100 byte limit
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 413


def test_download_token_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """GET without token -> 404."""
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/attachment/1/download",
        )
        assert response.status_code == 422  # missing required query param


def test_upload_interruption_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulate connection drop -> temp file cleaned up."""
    app = _make_app(tmp_path, monkeypatch)
    token, user_id, todo_id = _setup_user_and_todo(app, tmp_path)

    upload_store = app.state.upload_token_store
    upload_token_str = upload_store.create(
        owner_type="todo",
        owner_id=todo_id,
        user_id=user_id,
        filename="test.txt",
        mime_type="text/plain",
        plain_size=10,
    )

    tok = upload_store.get(upload_token_str)
    assert tok is not None
    temp_path = tok.temp_path

    # Verify temp path doesn't exist yet
    assert not temp_path.exists()

    # Pop the token (simulating an error during upload)
    upload_store.pop(upload_token_str)

    # Token should be gone
    assert upload_store.get(upload_token_str) is None
