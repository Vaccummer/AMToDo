"""Authentication dependencies."""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, status


LOCALHOST_ADDRS = {"127.0.0.1", "::1"}


async def require_localhost(request: Request) -> None:
    """Reject requests that did not originate from localhost."""
    client = request.client
    if client is None or client.host not in LOCALHOST_ADDRS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin endpoints are only accessible from localhost",
        )


async def require_admin(request: Request) -> None:
    """Validate the server admin token from the Authorization header."""
    admin_token = _bearer_token(request)
    expected: str = request.app.state.settings.admin_token
    if not hmac.compare_digest(admin_token, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token",
        )


async def require_user(request: Request) -> int:
    """Validate a user access token from the Authorization header."""
    access_token = _bearer_token(request)
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


def _bearer_token(request: Request) -> str:
    """Return the bearer token, or an empty string if the header is invalid."""
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return ""
    return token.strip()
