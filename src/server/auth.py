"""Bearer token authentication dependencies.

``require_admin`` validates the server admin token (for user management).
``require_user`` validates a per-user access token (for business endpoints).
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_security = HTTPBearer(auto_error=False)


def require_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
) -> None:
    """Validate the server admin token."""
    admin_token: str = request.app.state.settings.admin_token

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    if credentials.credentials != admin_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token",
        )


def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
) -> int:
    """Validate a user access token and return the user_id."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    token_map: dict[str, int] = request.app.state.token_map
    user_id = token_map.get(credentials.credentials)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid user token",
        )
    return user_id
