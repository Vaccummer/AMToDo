"""FastAPI dependency injection for UoW, clock, and settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, Request

from config import AppSettings
from clock import Clock, SystemClock
from server.auth import require_user

if TYPE_CHECKING:
    from collections.abc import Generator

    from services.uow import UnitOfWork


def get_settings(request: Request) -> AppSettings:
    """Return the server-configured settings."""
    return request.app.state.settings


def get_clock() -> Clock:
    """Return the system clock."""
    return SystemClock()


def get_uow(
    request: Request,
    user_id: int = Depends(require_user),
) -> Generator["UnitOfWork", None, None]:
    """Yield a UnitOfWork for the current user's per-user tables."""
    from services.uow import UnitOfWork

    database = request.app.state.db
    with UnitOfWork(database, user_id) as uow:
        yield uow
