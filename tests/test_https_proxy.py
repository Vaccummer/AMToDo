from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from config import AppSettings
from server.app import create_app


def test_trusted_proxy_headers_drive_rate_limit_ip(tmp_path: Path) -> None:
    settings = AppSettings(
        database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}",
        admin_token="admin-secret",
        rate_limit_requests=1,
        rate_limit_window_seconds=60,
        trusted_proxy_ips=("127.0.0.1",),
    )
    app = create_app(settings)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        first = client.get("/api/v1/agent-guide", headers={"X-Real-IP": "203.0.113.10"})
        second = client.get("/api/v1/agent-guide", headers={"X-Real-IP": "203.0.113.11"})
        third = client.get("/api/v1/agent-guide", headers={"X-Real-IP": "203.0.113.11"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


def test_untrusted_proxy_headers_are_ignored_for_rate_limit(tmp_path: Path) -> None:
    settings = AppSettings(
        database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}",
        admin_token="admin-secret",
        rate_limit_requests=1,
        rate_limit_window_seconds=60,
    )
    app = create_app(settings)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        first = client.get("/api/v1/agent-guide", headers={"X-Real-IP": "203.0.113.10"})
        second = client.get("/api/v1/agent-guide", headers={"X-Real-IP": "203.0.113.11"})

    assert first.status_code == 200
    assert second.status_code == 429


def test_forwarded_proto_enables_hsts_for_https_requests(tmp_path: Path) -> None:
    settings = AppSettings(
        database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}",
        admin_token="admin-secret",
        trusted_proxy_ips=("127.0.0.1",),
        hsts_enabled=True,
    )
    app = create_app(settings)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        response = client.get(
            "/api/v1/agent-guide",
            headers={"X-Forwarded-Proto": "https"},
        )

    assert response.status_code == 200
    assert response.headers["strict-transport-security"] == "max-age=15552000"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_unified_websocket_route_is_registered(tmp_path: Path) -> None:
    settings = AppSettings(
        database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}",
        admin_token="admin-secret",
    )
    app = create_app(settings)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        try:
            with client.websocket_connect("/api/v1/ws"):
                pass
        except WebSocketDisconnect as exc:
            assert exc.code == 1011
