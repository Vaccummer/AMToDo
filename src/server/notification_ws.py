"""WebSocket-based real-time notification push endpoints.

Exposes two routes under the ``/api/v1/notifications`` prefix:

* ``POST /ws-key`` — obtain a per-user AES-256-GCM session key
  (goes through the existing P-256 envelope-encryption middleware).

* ``WebSocket /ws`` — long-lived WebSocket connection authenticated
  via a ``key_hash`` derived from the session key.

The actual notification polling and push is driven by the background
``_notification_watcher`` task registered in ``app.py``.
"""

from __future__ import annotations

import asyncio
import base64
import json as _json
import logging
import time

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from serialization import notification_to_dict

logger = logging.getLogger("amtodo")

router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


# ---------------------------------------------------------------------------
# POST /ws-key
# ---------------------------------------------------------------------------

@router.post("/ws-key")
async def get_ws_session_key(request: Request) -> dict[str, object]:
    """Return a new AES-256-GCM session key for the authenticated user.

    This endpoint is protected by the existing P-256 envelope-encryption
    middleware — the ``access_token`` arrives inside the decrypted payload.
    """
    key_mgr = request.app.state.ws_key_manager

    # Re-use the auth dependency logic to get user_id from body
    body = await _read_body_cached(request)
    access_token = body.get("access_token", "")
    token_map: dict[str, int] = request.app.state.token_map
    user_id = token_map.get(access_token)

    if user_id is None:
        # fallback to DB
        from models.user import User
        from sqlalchemy import select

        db = request.app.state.db
        with db.session() as session:
            user = session.execute(
                select(User).where(User.token == access_token)
            ).scalar_one_or_none()
        if user is None:
            return {"ok": False, "error": "invalid access token"}
        user_id = user.id
        token_map[access_token] = user_id

    key, expires_at = key_mgr.create(user_id)
    return {
        "ok": True,
        "session_key": _b64url_encode(key),
        "expires_at": int(expires_at),
    }


async def _read_body_cached(request) -> dict:
    """Return parsed JSON body, reusing the cached parse when available."""
    import json

    cached = getattr(request.state, "_parsed_body", None)
    if cached is not None:
        return cached
    body_bytes = getattr(request, "_body", None)
    if body_bytes is None:
        body_bytes = await request.body()
    parsed = json.loads(body_bytes)
    request.state._parsed_body = parsed
    return parsed


# ---------------------------------------------------------------------------
# WebSocket /ws
# ---------------------------------------------------------------------------

@router.websocket("/ws")
async def websocket_notifications(websocket: WebSocket):
    """WebSocket endpoint for real-time notification push.

    Authentication flow:
    1. Client opens WebSocket connection.
    2. Client sends ``{"type": "auth", "key_hash": "<sha256 hex>"}``.
    3. Server resolves the key_hash to a user, verifies the key is valid,
       and replies ``auth_ok`` or ``auth_failed``.
    4. If authenticated, the connection is registered for push from the
       background ``notification_watcher``.

    The client is expected to reply with ``{"type": "pong"}`` to
    periodic server-initiated ``ping`` messages.
    """
    app = websocket.app

    key_mgr = app.state.ws_key_manager
    ws_mgr = app.state.ws_manager

    conn_id = None
    user_id = None

    # --- accept -----------------------------------------------------------
    await websocket.accept()

    # --- authentication handshake -----------------------------------------
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
    except asyncio.TimeoutError:
        await _safe_close(websocket, 4002, "auth timeout")
        return

    import json as _json
    try:
        msg = _json.loads(raw)
    except _json.JSONDecodeError:
        await _safe_close(websocket, 4003, "invalid json")
        return

    if msg.get("type") != "auth" or "key_hash" not in msg:
        await websocket.send_text(
            _json.dumps({"type": "auth_failed", "reason": "missing auth fields"})
        )
        await _safe_close(websocket, 4004, "auth required")
        return

    key_hash = msg["key_hash"]
    user_id = key_mgr.lookup_by_hash(key_hash)

    if user_id is None:
        await websocket.send_text(
            _json.dumps({"type": "auth_failed", "reason": "invalid key_hash"})
        )
        await _safe_close(websocket, 4005, "invalid key_hash")
        return

    # --- register connection ----------------------------------------------
    conn_id = await ws_mgr.connect(websocket, user_id)

    await websocket.send_text(_json.dumps({"type": "auth_ok"}))

    # --- message loop -----------------------------------------------------
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except _json.JSONDecodeError:
                continue

            if msg.get("type") == "pong":
                # Heartbeat reply — just acknowledge it was received;
                # the heartbeat task will handle timeouts on the server side.
                pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning(
            "WebSocket error: user_id=%d conn_id=%s: %s", user_id, conn_id, exc
        )
    finally:
        if conn_id is not None and user_id is not None:
            ws_mgr.disconnect(user_id, conn_id)


async def _safe_close(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await ws.close(code=code, reason=reason)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# background tasks (started from app.py lifespan)
# ---------------------------------------------------------------------------

async def _notification_watcher(
    ws_mgr,
    key_mgr,
    db,
    token_map: dict[str, int],
    config: dict,
) -> None:
    """Periodic background task: query triggered notifications for every
    user with an active WebSocket connection and push encrypted messages.

    *config* is the ``[notification]`` section from ``server.toml``.
    """
    from server.websocket_manager import NotificationResultCache

    interval = int(config.get("watcher_interval", 10))
    _watermarks: dict[int, int] = {}  # user_id → last_check_ts
    _cache = NotificationResultCache(ttl_seconds=interval * 0.8)

    while True:
        await asyncio.sleep(interval)
        now_ts = int(time.time())

        for user_id in list(ws_mgr.active_users):
            # --- key validity check --------------------------------------
            if key_mgr.get(user_id) is None:
                await ws_mgr.disconnect_all(user_id)
                _cache.evict(user_id)
                _watermarks.pop(user_id, None)
                continue

            # --- query triggered notifications (with cache) --------------
            last_check = _watermarks.get(user_id, now_ts - 60)
            notifications = _cache.get(user_id)

            if notifications is None:
                try:
                    notifications = _query_notifications(
                        db, token_map, user_id, after=last_check, now=now_ts
                    )
                except Exception as exc:
                    logger.error(
                        "notification_watcher: query failed for user %d: %s",
                        user_id, exc,
                    )
                    continue
                _cache.set(user_id, notifications)

            # --- push encrypted messages ---------------------------------
            for n in notifications:
                try:
                    notif_dict = notification_to_dict(n)
                    plain = _json.dumps(notif_dict).encode("utf-8")
                    encrypted = key_mgr.encrypt(user_id, plain)
                    await ws_mgr.push_to_user(user_id, {
                        "type": "notification",
                        "data": _b64url_encode(encrypted),
                    })
                except Exception as exc:
                    logger.error(
                        "notification_watcher: push failed for user %d: %s",
                        user_id, exc,
                    )

            _watermarks[user_id] = now_ts


async def _heartbeat_task(ws_mgr, config: dict) -> None:
    """Periodically send ``ping`` messages to every active WebSocket.

    *config* is the ``[notification]`` section from ``server.toml``.
    """
    interval = int(config.get("heartbeat_interval", 30))

    while True:
        await asyncio.sleep(interval)
        for user_id in list(ws_mgr.active_users):
            # push_to_user handles send failures and cleans up dead connections
            await ws_mgr.push_to_user(user_id, {"type": "ping"})


# ---------------------------------------------------------------------------
# internal helpers
# ---------------------------------------------------------------------------

def _query_notifications(
    db,
    token_map: dict[str, int],
    user_id: int,
    *,
    after: int,
    now: int,
) -> list[object]:
    """Run a ``list_triggered`` query inside a per-user unit-of-work."""
    from clock import SystemClock
    from services import NotificationService
    from services.uow import UnitOfWork

    with UnitOfWork(db, user_id) as uow:
        clock = SystemClock()
        svc = NotificationService(
            uow.notifications,
            uow.notification_mentions,
            clock,
            uow.notification_model,
            uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        return svc.list_triggered(after=after, now=now)
