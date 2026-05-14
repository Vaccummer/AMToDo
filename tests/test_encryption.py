"""Integration tests for end-to-end request encryption."""

from __future__ import annotations

import secrets

import pytest
from fastapi.testclient import TestClient

from clock import SystemClock
from config import AppSettings
from amtodo_crypto import generate_keypair, open_response, seal
from models.user import User
from server.app import create_app


@pytest.fixture
def encrypted_setup(tmp_path):
    """Create an app with encryption enabled, return (TestClient, public_pem, token, user_id)."""
    keys_dir = tmp_path / "keys"
    keys_dir.mkdir()
    private_pem, public_pem = generate_keypair()
    (keys_dir / "server_private.pem").write_bytes(private_pem)

    db_path = tmp_path / "test.sqlite3"
    settings = AppSettings(
        database_url=f"sqlite:///{db_path}",
        admin_token="admin-secret",
        server_private_key_path=str(keys_dir / "server_private.pem"),
        request_timestamp_tolerance_seconds=300,
    )
    app = create_app(settings)

    token = secrets.token_urlsafe(32)
    clock = SystemClock()

    with TestClient(app) as c:
        db = app.state.db
        token_map: dict[str, int] = app.state.token_map

        with db.session() as session:
            user = User(
                name="test-encrypted",
                token=token,
                created_at=clock.now_epoch(),
            )
            session.add(user)
            session.commit()
            user_id = user.id

        token_map[token] = user_id
        from models.factory import get_user_tables

        get_user_tables(user_id)
        db.create_schema()

        yield c, public_pem, token, user_id


class TestEncryptedRequests:
    def test_create_todo_encrypted(self, encrypted_setup):
        client, public_pem, token, _user_id = encrypted_setup
        payload = {"title": "encrypted todo", "priority": 5}
        envelope, data_key = seal(payload, public_pem, "server-key-v1")

        response = client.post(
            "/api/v1/todos",
            json=envelope,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = open_response(response.json(), data_key)
        assert data["ok"] is True
        assert data["todo"]["title"] == "encrypted todo"
        assert data["todo"]["priority"] == 5

    def test_plain_request_is_rejected(self, encrypted_setup):
        client, _public_pem, token, _user_id = encrypted_setup
        response = client.post(
            "/api/v1/todos",
            json={"title": "plain todo", "priority": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 400
        data = response.json()
        assert "encrypted" in data["error"]["message"].lower()

    def test_replayed_request_rejected(self, encrypted_setup):
        client, public_pem, token, _user_id = encrypted_setup
        payload = {"title": "replay test", "priority": 1}
        envelope, _ = seal(payload, public_pem, "server-key-v1")

        # First request succeeds
        r1 = client.post(
            "/api/v1/todos",
            json=envelope,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r1.status_code == 200

        # Replayed request with same requestId is rejected
        r2 = client.post(
            "/api/v1/todos",
            json=envelope,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 400
        assert "duplicate" in r2.json()["error"]["message"].lower()

    def test_invalid_envelope_rejected(self, encrypted_setup):
        client, public_pem, token, _user_id = encrypted_setup
        # Generate a valid envelope, then corrupt it
        payload = {"title": "test", "priority": 1}
        envelope, _ = seal(payload, public_pem, "server-key-v1")
        envelope["ek"] = "AAAA"  # corrupt

        response = client.post(
            "/api/v1/todos",
            json=envelope,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 400

    def test_get_requests_not_encrypted(self, encrypted_setup):
        """GET requests should pass through without encryption."""
        client, _public_pem, token, _user_id = encrypted_setup
        response = client.get(
            "/api/v1/todos",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

    def test_unknown_key_id_rejected(self, encrypted_setup):
        client, public_pem, token, _user_id = encrypted_setup
        # Seal with a different key_id than what the server has
        payload = {"title": "test", "priority": 1}
        envelope, _ = seal(payload, public_pem, "wrong-key-id")

        response = client.post(
            "/api/v1/todos",
            json=envelope,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 400
