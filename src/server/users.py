"""Admin routes for user management (protected by admin_token in body)."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from clock import Clock, SystemClock
from exceptions import ConflictError, NotFoundError
from models.factory import get_user_tables
from models.user import User
from serialization import user_to_dict
from server.auth import require_admin
from server.schemas import (
    AdminUserCreateRequest,
    AdminUserDeleteRequest,
    AdminUserListRequest,
    AdminUserRegenTokenRequest,
    AdminUserUpdateRequest,
)

router = APIRouter()


def _next_user_id(session) -> int:
    row = session.execute(
        select(User.id).order_by(User.id.desc()).limit(1)
    ).scalar_one_or_none()
    return (row + 1) if row is not None else 1


@router.post("/list")
def list_users(
    body: AdminUserListRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """List all registered users."""
    db = request.app.state.db

    with db.session() as session:
        users = list(
            session.execute(select(User).order_by(User.id)).scalars().all()
        )
        return {
            "ok": True,
            "count": len(users),
            "users": [user_to_dict(u) for u in users],
        }


@router.post("/create")
def create_user(
    body: AdminUserCreateRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Create a new user with a generated access token and per-user tables."""
    db = request.app.state.db
    token_map: dict[str, int] = request.app.state.token_map
    clock: Clock = SystemClock()

    with db.session() as session:
        existing = session.execute(
            select(User).where(User.name == body.name)
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(f"user with name '{body.name}' already exists")

        token = secrets.token_urlsafe(32)
        user_id = _next_user_id(session)

        user = User(
            id=user_id,
            name=body.name,
            token=token,
            created_at=clock.now_epoch(),
        )
        session.add(user)
        session.commit()

        result = user_to_dict(user)

    # Register per-user tables and create them in the schema
    get_user_tables(user_id)
    db.create_schema()

    # Update the in-memory token map
    token_map[token] = user_id

    return {"ok": True, "user": result}


@router.post("/delete")
def delete_user(
    body: AdminUserDeleteRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Delete a user."""
    db = request.app.state.db
    token_map: dict[str, int] = request.app.state.token_map

    with db.session() as session:
        user = session.get(User, body.user_id)
        if user is None:
            raise NotFoundError(f"user {body.user_id} not found")

        token = user.token
        name = user.name

        session.delete(user)
        session.commit()

    # Remove from token map
    token_map.pop(token, None)

    return {"ok": True, "deleted": {"id": body.user_id, "name": name}}


@router.post("/update")
def update_user(
    body: AdminUserUpdateRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Modify a user's name."""
    if body.name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field must be provided",
        )

    db = request.app.state.db

    with db.session() as session:
        user = session.get(User, body.user_id)
        if user is None:
            raise NotFoundError(f"user {body.user_id} not found")

        if body.name is not None:
            existing = session.execute(
                select(User).where(User.name == body.name, User.id != body.user_id)
            ).scalar_one_or_none()
            if existing is not None:
                raise ConflictError(f"user with name '{body.name}' already exists")
            user.name = body.name

        session.commit()
        return {"ok": True, "user": user_to_dict(user)}


@router.post("/regen-token")
def regenerate_token(
    body: AdminUserRegenTokenRequest,
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Regenerate a user's access token."""
    db = request.app.state.db
    token_map: dict[str, int] = request.app.state.token_map

    with db.session() as session:
        user = session.get(User, body.user_id)
        if user is None:
            raise NotFoundError(f"user {body.user_id} not found")

        old_token = user.token

        # Generate a token that is globally unique
        for _ in range(10):
            new_token = secrets.token_urlsafe(32)
            if new_token not in token_map:
                existing = session.execute(
                    select(User).where(User.token == new_token)
                ).scalar_one_or_none()
                if existing is None:
                    break
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate unique token",
            )

        user.token = new_token
        session.commit()

        token_map.pop(old_token, None)
        token_map[new_token] = body.user_id

        return {"ok": True, "user": user_to_dict(user)}
