"""ORM model registry."""

from __future__ import annotations

from models.schedule import Schedule
from models.setting import Setting
from models.todo import Todo
from models.user import User

__all__ = ["Schedule", "Setting", "Todo", "User", "register_models"]


def register_models() -> None:
    """Import models and register concrete standalone tables with metadata."""

    from models.factory import get_standalone_tables

    get_standalone_tables()
