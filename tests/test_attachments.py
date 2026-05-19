"""Attachment service and cache tests."""

from __future__ import annotations

import base64
import secrets
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

import config
from client.attachment_cache import AttachmentCache
from clock import FixedClock, SystemClock
from config import AppSettings
from db.engine import create_database
from models.factory import get_user_tables
from models.user import User
from serialization import attachment_to_dict
from server.app import create_app
from services import AttachmentDraft, AttachmentService, TodoDraft, TodoService
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from db.engine import Database


def test_attachment_is_encrypted_and_cache_decrypts(tmp_path: Path) -> None:
    database = _create_test_database(tmp_path)
    clock = FixedClock(1_800_000_000)
    content = b"attachment plaintext"

    with UnitOfWork(database) as uow:
        todo = TodoService(uow.todos, clock, uow.todo_model).create(TodoDraft(title="With file"))
        uow.session.flush()
        service = _attachment_service(uow, clock, tmp_path)
        attachment = service.create(
            todo.id,
            AttachmentDraft(filename="note.txt", content=content, mime_type="text/plain"),
        )
        uow.session.flush()
        metadata = attachment_to_dict(attachment, uow.user_id)
        cipher = service.read_cipher(todo.id, attachment.id)

    assert cipher != content
    assert metadata["plain_sha256"] != metadata["cipher_sha256"]

    cache = AttachmentCache(tmp_path)
    first = cache.get_or_download(metadata, lambda: cipher)
    second = cache.get_or_download(metadata, lambda: cipher)

    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert Path(str(first["path"])).read_bytes() == content


def test_attachment_remove_deletes_cipher_file(tmp_path: Path) -> None:
    database = _create_test_database(tmp_path)
    clock = FixedClock(1_800_000_000)

    with UnitOfWork(database) as uow:
        todo = TodoService(uow.todos, clock, uow.todo_model).create(TodoDraft(title="With file"))
        uow.session.flush()
        service = _attachment_service(uow, clock, tmp_path)
        attachment = service.create(
            todo.id,
            AttachmentDraft(filename="note.txt", content=b"hello"),
        )
        uow.session.flush()
        path = service.encrypted_path(attachment)
        assert path.is_file()

        removed = service.remove(todo.id, attachment.id)

    assert removed.id == attachment.id
    assert not path.exists()


def test_attachment_http_upload_metadata_and_download(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "_AMTODO_SERVER_ROOT_CACHE", tmp_path)
    att_root = tmp_path / "attachments"
    att_root.mkdir(parents=True, exist_ok=True)
    app = create_app(
        AppSettings(
            database_url=f"sqlite:///{tmp_path / 'server.sqlite3'}",
            admin_token="admin-secret",
            attachment_root=str(att_root),
        )
    )
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
            json={"access_token": token, "title": "With upload"},
        )
        todo_id = todo_response.json()["todo"]["id"]

        upload_response = client.post(
            "/api/v1/todos/attachments/upload",
            json={
                "access_token": token,
                "todo_id": todo_id,
                "filename": "note.txt",
                "mime_type": "text/plain",
                "content_base64": base64.b64encode(b"plaintext").decode("ascii"),
            },
        )
        assert upload_response.status_code == 200
        attachment = upload_response.json()["attachment"]
        assert attachment["filename"] == "note.txt"
        assert attachment["file_key"]

        list_response = client.post(
            "/api/v1/todos/attachments/list",
            json={"access_token": token, "todo_id": todo_id},
        )
        assert list_response.json()["count"] == 1

        download_response = client.post(
            "/api/v1/todos/attachments/download",
            json={
                "access_token": token,
                "todo_id": todo_id,
                "attachment_id": attachment["id"],
            },
        )
        assert download_response.status_code == 200
        assert download_response.content != b"plaintext"


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


def _create_test_database(tmp_path: Path) -> Database:
    settings = AppSettings(database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}")
    database = create_database(settings)
    database.create_schema()
    return database
