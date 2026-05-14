"""Authentication dependencies.

Tokens are passed in the request body (not ``Authorization`` header).

``require_admin`` validates ``admin_token`` from the JSON body against the
server-configured admin token.

``require_user`` looks up ``access_token`` from the JSON body in the
in-memory ``token_map`` and returns the corresponding ``user_id``.

Both read the body without consuming it via ``Body()`` so that FastAPI
treats the Pydantic request model as the sole body parameter (flat mode).
"""

from __future__ import annotations

import json

from fastapi import HTTPException, Request, status


async def require_admin(request: Request) -> None:
    """Validate the server admin token from the request body."""
    body = await _read_body(request)
    admin_token = body.get("admin_token", "")
    expected: str = request.app.state.settings.admin_token
    if admin_token != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token",
        )


async def require_user(request: Request) -> int:
    """Validate a user access token from the request body. Returns user_id."""
    body = await _read_body(request)
    access_token = body.get("access_token", "")
    token_map: dict[str, int] = request.app.state.token_map
    user_id = token_map.get(access_token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid user token",
        )
    return user_id


async def _read_body(request: Request) -> dict:
    """Return the parsed JSON body without affecting FastAPI body resolution.

    Uses ``request._body`` when available (set by the decryption middleware),
    otherwise reads and caches via ``request.body()``.
    """
    body_bytes = getattr(request, "_body", None)
    if body_bytes is None:
        body_bytes = await request.body()
    return json.loads(body_bytes)
