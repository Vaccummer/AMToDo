"""Pydantic schemas for the UI WebSocket message protocol."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Any


class WsRequest(BaseModel):
    """Client → Server request message."""

    id: str
    type: str
    payload: dict[str, Any] | None = None


class WsResponse(BaseModel):
    """Server → Client response message."""

    id: str
    type: str = "response"
    ok: bool
    data: Any | None = None
    error: str | None = None
    code: str | None = None


class WsPush(BaseModel):
    """Server → Client push message (no id)."""

    type: str
    payload: Any | None = None


class WsAuth(BaseModel):
    """Client → Server auth message (P-256 envelope)."""

    type: str  # must be "auth"
    envelope: dict[str, Any]
