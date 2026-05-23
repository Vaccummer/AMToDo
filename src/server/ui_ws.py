"""UI WebSocket endpoint — single connection for all CRUD + notifications.

Exposes ``WS /api/v1/ui/ws`` with a P-256 envelope auth handshake,
followed by AES-256-GCM encrypted request/response messages.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from amtodo_crypto import open_envelope_with_key
from amtodo_crypto.session import aes_gcm_decrypt, aes_gcm_encrypt
from server.ui_ws_handler import UiMessageRouter

logger = logging.getLogger("amtodo")

router = APIRouter()

# Auth close codes
CLOSE_AUTH_TIMEOUT = 4002
CLOSE_INVALID_ENVELOPE = 4003
CLOSE_MISSING_FIELDS = 4004
CLOSE_INVALID_TOKEN = 4005
CLOSE_REPLAY_DETECTED = 4006

AUTH_TIMEOUT_SECONDS = 10.0
PING_INTERVAL_SECONDS = 30
PONG_TIMEOUT_SECONDS = 60


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def _aes_encrypt(key: bytes, plaintext: bytes) -> str:
    """AES-256-GCM encrypt, return base64url(nonce || ciphertext_with_tag)."""
    nonce = os.urandom(12)
    ct = aes_gcm_encrypt(plaintext, key, nonce)
    return _b64url_encode(nonce + ct)


def _aes_decrypt(key: bytes, encoded: str) -> bytes:
    """Decrypt base64url(nonce || ciphertext_with_tag) with AES-256-GCM."""
    raw = _b64url_decode(encoded)
    nonce = raw[:12]
    ct_with_tag = raw[12:]
    return aes_gcm_decrypt(ct_with_tag, key, nonce)


@router.websocket("/ui/ws")
async def ui_ws_endpoint(websocket: WebSocket):
    """UI WebSocket endpoint with self-contained P-256 auth handshake."""

    app = websocket.app
    key_mgr = app.state.ws_key_manager
    ws_mgr = app.state.ws_manager
    token_map: dict[str, int] = app.state.token_map
    db = app.state.db
    settings = app.state.settings

    # Get the parsed private key (stored by _setup_encryption_middleware)
    private_key: ec.EllipticCurvePrivateKey | None = getattr(
        app.state, "encryption_private_key", None
    )
    if private_key is None:
        await _safe_close(websocket, 1011, "encryption not configured")
        return

    conn_id = None
    user_id = None

    await websocket.accept()

    # --- Step 1: Server Hello — send P-256 public key ---
    pub_bytes = private_key.public_key().public_bytes(
        encoding=Encoding.DER,
        format=PublicFormat.SubjectPublicKeyInfo,
    )
    await _send_json(websocket, {
        "type": "server_hello",
        "public_key": _b64url_encode(pub_bytes),
    })

    # --- Step 2: Wait for auth message ---
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        await _safe_close(websocket, CLOSE_AUTH_TIMEOUT, "auth timeout")
        return
    except WebSocketDisconnect:
        return

    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await _safe_close(websocket, CLOSE_INVALID_ENVELOPE, "invalid json")
        return

    if msg.get("type") != "auth" or "envelope" not in msg:
        await _safe_close(websocket, CLOSE_MISSING_FIELDS, "missing auth envelope")
        return

    # --- Step 3: Decrypt P-256 envelope ---
    try:
        inner, _data_key = open_envelope_with_key(msg["envelope"], private_key)
    except Exception:
        await _safe_close(websocket, CLOSE_INVALID_ENVELOPE, "invalid envelope")
        return

    # Replay protection
    try:
        app.state.replay_protector.check_and_record(
            inner["requestId"], inner["timestamp"]
        )
    except ValueError:
        await _safe_close(websocket, CLOSE_REPLAY_DETECTED, "replay detected")
        return

    payload = inner.get("payload", {})
    access_token = payload.get("access_token")
    session_key_b64 = payload.get("session_key")

    logger.info(
        "UI WS auth: token_len=%d, token_prefix=%s..., has_session_key=%s",
        len(access_token) if access_token else 0,
        (access_token[:8] if len(access_token) >= 8 else access_token) if access_token else "None",
        bool(session_key_b64),
    )

    if not access_token or not session_key_b64:
        await _safe_close(websocket, CLOSE_MISSING_FIELDS, "missing token or session_key")
        return

    # --- Step 4: Validate access_token → user_id ---
    user_id = token_map.get(access_token)
    if user_id is not None:
        logger.info("UI WS auth: token found in cache, user_id=%d", user_id)
    else:
        from models.user import User
        from sqlalchemy import select

        with db.session() as session:
            user = session.execute(
                select(User).where(User.token == access_token)
            ).scalar_one_or_none()
        if user is None:
            logger.warning(
                "UI WS auth failed: token not found (len=%d, prefix=%s...)",
                len(access_token),
                access_token[:8] if len(access_token) >= 8 else access_token,
            )
            await _safe_close(websocket, CLOSE_INVALID_TOKEN, "invalid token")
            return
        user_id = user.id
        token_map[access_token] = user_id
        logger.info("UI WS auth: token found in DB, user_id=%d", user_id)

    # --- Step 5: Store client-provided session key ---
    session_key = _b64url_decode(session_key_b64)
    key_mgr.store(user_id, session_key)

    # --- Step 6: Register connection + send auth_ok ---
    conn_id = await ws_mgr.connect(websocket, user_id, session_key=session_key)
    await _send_json(websocket, {"type": "auth_ok"})

    # --- Step 7: Message loop ---
    upload_token_store = getattr(app.state, "upload_token_store", None)
    download_token_store = getattr(app.state, "download_token_store", None)
    router_handler = UiMessageRouter(
        user_id, db, settings, app.state.attachment_root,
        upload_token_store=upload_token_store,
        download_token_store=download_token_store,
    )
    last_pong = time.monotonic()

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            msg_type = msg.get("type")

            # Heartbeat reply
            if msg_type == "pong":
                last_pong = time.monotonic()
                continue

            # Ping to client (server-initiated heartbeat handled by _heartbeat_task)
            if msg_type == "ping":
                continue

            # Business request: must have id and type
            msg_id = msg.get("id")
            if not msg_id or not msg_type:
                await _send_json(websocket, {
                    "id": msg_id or "?",
                    "type": "response",
                    "ok": False,
                    "error": "Invalid message: missing id or type",
                })
                continue

            # Decrypt payload if encrypted
            payload = msg.get("payload")
            if payload and isinstance(payload, str):
                try:
                    key = ws_mgr.get_key(user_id, conn_id)
                    if key is None:
                        await _safe_close(websocket, 4001, "session expired")
                        break
                    decrypted = _aes_decrypt(key, payload)
                    payload = json.loads(decrypted)
                except Exception as exc:
                    logger.warning("UI WS decrypt error: user_id=%d: %s", user_id, exc)
                    await _send_json(websocket, {
                        "id": msg_id,
                        "type": "response",
                        "ok": False,
                        "error": "Decryption failed",
                    })
                    continue

            # Route to handler
            try:
                result = await router_handler.route(msg_type, payload)
                response_data = result
                response_ok = True
                response_error = None
            except Exception as exc:
                logger.warning(
                    "UI WS handler error: user_id=%d type=%s: %s",
                    user_id, msg_type, exc,
                )
                response_data = None
                response_ok = False
                response_error = str(exc)

            # Build response
            resp: dict = {
                "id": msg_id,
                "type": "response",
                "ok": response_ok,
            }

            # Encrypt response data
            if response_data is not None:
                try:
                    key = ws_mgr.get_key(user_id, conn_id)
                    if key is not None:
                        resp["data"] = _aes_encrypt(
                            key, json.dumps(response_data).encode("utf-8")
                        )
                    else:
                        resp["data"] = response_data
                except Exception:
                    resp["data"] = response_data

            if response_error is not None:
                resp["error"] = response_error

            await _send_json(websocket, resp)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("UI WS error: user_id=%d conn_id=%s: %s", user_id, conn_id, exc)
    finally:
        if conn_id is not None and user_id is not None:
            ws_mgr.disconnect(user_id, conn_id)


async def _send_json(ws: WebSocket, data: dict) -> None:
    await ws.send_text(json.dumps(data))


async def _safe_close(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await ws.close(code=code, reason=reason)
    except Exception:
        pass
