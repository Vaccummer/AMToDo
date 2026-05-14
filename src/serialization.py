"""Shared model-to-dict serialization used by CLI and server."""

from __future__ import annotations

from models import Schedule, Todo
from models.user import User


def user_to_dict(user: User) -> dict[str, object]:
    """Serialize a User ORM instance to the standard JSON payload."""
    return {
        "id": user.id,
        "name": user.name,
        "token": user.token,
        "created_at": user.created_at,
    }


def todo_to_dict(todo: Todo, timezone: str) -> dict[str, object]:
    """Serialize a Todo ORM instance to the standard JSON payload."""
    return {
        "id": todo.id,
        "title": todo.title,
        "description": todo.description,
        "planned_at": todo.planned_at,
        "due_at": todo.due_at,
        "completed": todo.completed,
        "priority": todo.priority,
        "tag": todo.tag,
        "created_at": todo.created_at,
        "updated_at": todo.updated_at,
        "completed_at": todo.completed_at,
    }


def schedule_to_dict(schedule: Schedule) -> dict[str, object]:
    """Serialize a Schedule ORM instance to the standard JSON payload."""
    return {
        "id": schedule.id,
        "title": schedule.title,
        "description": schedule.description,
        "start_at": schedule.start_at,
        "end_at": schedule.end_at,
        "duration": schedule.end_at - schedule.start_at,
        "timezone": schedule.timezone,
        "location": schedule.location,
        "category": schedule.category,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def error_to_dict(exc_type: type[BaseException], message: str) -> dict[str, object]:
    """Serialize an error to the standard error payload."""
    return {"ok": False, "error": {"type": exc_type.__name__, "message": message}}
