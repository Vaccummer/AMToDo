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

import hmac
import json

from fastapi import HTTPException, Request, status


async def require_admin(request: Request) -> None:
    """Validate the server admin token from the request body."""
    body = await _read_body(request)
    admin_token = body.get("admin_token", "")
    expected: str = request.app.state.settings.admin_token
    if not hmac.compare_digest(admin_token, expected):
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
        user_id = _lookup_token_in_db(request, access_token)
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid user token",
            )
        token_map[access_token] = user_id
    return user_id


def _lookup_token_in_db(request: Request, access_token: str) -> int | None:
    """Fallback: look up the token in the database when not in the memory map."""

    from models.user import User
    from sqlalchemy import select

    db = request.app.state.db
    with db.session() as session:
        user = session.execute(
            select(User).where(User.token == access_token)
        ).scalar_one_or_none()
    return user.id if user is not None else None


async def _read_body(request: Request) -> dict:
    """Return the parsed JSON body without affecting FastAPI body resolution.

    Uses ``request._body`` when available (set by the decryption middleware),
    otherwise reads and caches via ``request.body()``.  The parsed dict is
    cached on ``request.state`` so that repeated calls (e.g. from both
    ``require_admin`` and FastAPI body resolution) do not re-parse.
    """
    cached = getattr(request.state, "_parsed_body", None)
    if cached is not None:
        return cached
    body_bytes = getattr(request, "_body", None)
    if body_bytes is None:
        body_bytes = await request.body()
    parsed = json.loads(body_bytes)
    request.state._parsed_body = parsed
    return parsed
