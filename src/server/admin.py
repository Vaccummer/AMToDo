"""Admin routes: health check and database initialization."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from config import __version__
from db.base import Base
from server.auth import require_admin

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    """Return server health status."""
    return {"status": "ok", "version": __version__}


@router.post("/admin/init-db")
def init_db(
    request: Request,
    _auth: None = Depends(require_admin),
) -> dict[str, object]:
    """Initialize database schema."""
    db = request.app.state.db
    Base.metadata.create_all(db.engine)
    return {"ok": True, "database": "initialized"}
