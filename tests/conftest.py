"""Shared test fixtures for AMToDo server tests."""

from __future__ import annotations

import secrets

import pytest
from fastapi.testclient import TestClient

from clock import SystemClock
from config import AppSettings
from models.factory import get_user_tables
from models.user import User
from server.app import create_app


class AuthedClient:
    """Wraps TestClient to inject Authorization header on every request."""

    def __init__(self, client: TestClient, token: str) -> None:
        self._client = client
        self._headers = {"Authorization": f"Bearer {token}"}

    def get(self, url, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.get(url, headers=headers, **kwargs)

    def post(self, url, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.post(url, headers=headers, **kwargs)

    def patch(self, url, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.patch(url, headers=headers, **kwargs)

    def put(self, url, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.put(url, headers=headers, **kwargs)

    def delete(self, url, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.delete(url, headers=headers, **kwargs)


@pytest.fixture
def client_and_token(tmp_path):
    """Create an app with single database + test user, return (AuthedClient, token)."""
    db_path = tmp_path / "test.sqlite3"
    settings = AppSettings(
        database_url=f"sqlite:///{db_path}",
        admin_token="admin-secret",
    )
    app = create_app(settings)

    token = secrets.token_urlsafe(32)
    clock = SystemClock()

    with TestClient(app) as c:
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

        yield AuthedClient(c, token), token
