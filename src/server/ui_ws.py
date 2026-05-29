"""Unified UI WebSocket endpoint for CRUD and notifications."""

from __future__ import annotations

import json
import logging
import asyncio
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.ui_ws_handler import UiMessageRouter

logger = logging.getLogger("amtodo")

router = APIRouter()

AMTODO_SUBPROTOCOL = "amtodo.v1"
CLOSE_INVALID_TOKEN = 4005


@router.websocket("/ws")
async def ui_ws_endpoint(websocket: WebSocket) -> None:
    """Authenticate during the WebSocket handshake and exchange plain JSON."""

    app = websocket.app
    token_map: dict[str, int] = app.state.token_map
    db = app.state.db
    settings = app.state.settings
    shutdown_event = getattr(app.state, "shutdown_event", None)

    access_token = _token_from_subprotocol(websocket)
    if not access_token:
        await _safe_close(websocket, CLOSE_INVALID_TOKEN, "missing bearer token")
        return

    user_id = _lookup_user_id(db, token_map, access_token)
    if user_id is None:
        await _safe_close(websocket, CLOSE_INVALID_TOKEN, "invalid bearer token")
        return

    await websocket.accept(subprotocol=AMTODO_SUBPROTOCOL)
    ws_mgr = app.state.ws_manager
    conn_id = await ws_mgr.connect(websocket, user_id)

    upload_token_store = getattr(app.state, "upload_token_store", None)
    router_handler = UiMessageRouter(
        user_id,
        db,
        settings,
        app.state.attachment_root,
        upload_token_store=upload_token_store,
    )

    try:
        while True:
            raw = await _receive_text_or_shutdown(websocket, shutdown_event)
            if raw is None:
                return
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json(websocket, {
                    "id": "?",
                    "type": "response",
                    "ok": False,
                    "error": "Invalid message: malformed JSON",
                })
                continue

            msg_type = msg.get("type")
            if msg_type == "pong":
                continue
            if msg_type == "ping":
                await _send_json(websocket, {"type": "pong"})
                continue

            msg_id = msg.get("id")
            if not msg_id or not msg_type:
                await _send_json(websocket, {
                    "id": msg_id or "?",
                    "type": "response",
                    "ok": False,
                    "error": "Invalid message: missing id or type",
                })
                continue

            try:
                result = await router_handler.route(msg_type, msg.get("payload"))
                response: dict[str, object] = {
                    "id": msg_id,
                    "type": "response",
                    "ok": True,
                    "data": result,
                }
            except Exception as exc:
                logger.warning(
                    "UI WS handler error: user_id=%d type=%s: %s",
                    user_id,
                    msg_type,
                    exc,
                )
                response = {
                    "id": msg_id,
                    "type": "response",
                    "ok": False,
                    "error": str(exc),
                }

            await _send_json(websocket, response)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("UI WS error: user_id=%d conn_id=%s: %s", user_id, conn_id, exc)
    finally:
        ws_mgr.disconnect(user_id, conn_id)


def _token_from_subprotocol(websocket: WebSocket) -> str:
    header = websocket.headers.get("sec-websocket-protocol", "")
    for item in header.split(","):
        protocol = item.strip()
        if protocol.startswith("bearer.") and len(protocol) > len("bearer."):
            return protocol[len("bearer."):]
    return ""


def _lookup_user_id(db, token_map: dict[str, int], access_token: str) -> int | None:
    user_id = token_map.get(access_token)
    if user_id is not None:
        return user_id

    from models.user import User
    from sqlalchemy import select

    with db.session() as session:
        user = session.execute(
            select(User).where(User.token == access_token)
        ).scalar_one_or_none()
    if user is None:
        return None
    token_map[access_token] = user.id
    return user.id


async def _send_json(ws: WebSocket, data: dict[str, object]) -> None:
    await ws.send_text(json.dumps(data))


async def _receive_text_or_shutdown(ws: WebSocket, shutdown_event: Any) -> str | None:
    if shutdown_event is None:
        return await ws.receive_text()

    receive_task = asyncio.create_task(ws.receive_text())
    shutdown_task = asyncio.create_task(shutdown_event.wait())
    done, pending = await asyncio.wait(
        {receive_task, shutdown_task},
        return_when=asyncio.FIRST_COMPLETED,
    )

    if shutdown_task in done:
        receive_task.cancel()
        with suppress(asyncio.CancelledError):
            await receive_task
        await _safe_close(ws, 1001, "server shutting down")
        return None

    for task in pending:
        task.cancel()
    with suppress(asyncio.CancelledError):
        await shutdown_task
    return await receive_task


async def _safe_close(ws: WebSocket, code: int, reason: str) -> None:
    try:
        await ws.close(code=code, reason=reason)
    except Exception:
        pass
