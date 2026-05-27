"""Shared model-to-dict serialization used by CLI and server."""

from __future__ import annotations

from models import Schedule, Todo, TodoAttachment
from models.user import User


def user_to_dict(user: User) -> dict[str, object]:
    """Serialize a User ORM instance to the standard JSON payload."""
    return {
        "id": user.id,
        "name": user.name,
        "created_at": user.created_at,
    }


def user_to_dict_with_token(user: User) -> dict[str, object]:
    """Serialize a User ORM instance including the access token (CLI only)."""
    return {
        "id": user.id,
        "name": user.name,
        "token": user.token,
        "created_at": user.created_at,
    }


def todo_to_dict(
    todo: Todo, timezone: str, *, attachment_count: int | None = None
) -> dict[str, object]:
    """Serialize a Todo ORM instance to the standard JSON payload."""
    d: dict[str, object] = {
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
        "deleted_at": todo.deleted_at,
        "extra_fields": todo.extra_fields,
    }
    if attachment_count is not None:
        d["attachment_count"] = attachment_count
    return d


def attachment_to_dict(attachment: TodoAttachment, user_id: int) -> dict[str, object]:
    """Serialize a ToDo attachment metadata row."""

    return {
        "id": attachment.id,
        "user_id": user_id,
        "todo_id": attachment.todo_id,
        "file_index": attachment.file_index,
        "filename": attachment.filename,
        "mime_type": attachment.mime_type,
        "preview_kind": attachment.preview_kind,
        "plain_size_bytes": attachment.plain_size_bytes,
        "plain_sha256": attachment.plain_sha256,
        "storage_path": attachment.storage_path,
        "is_orphaned": attachment.is_orphaned,
        "created_at": attachment.created_at,
        "updated_at": attachment.updated_at,
    }


def schedule_attachment_to_dict(attachment: object, user_id: int) -> dict[str, object]:
    """Serialize a Schedule attachment metadata row."""

    return {
        "id": attachment.id,
        "user_id": user_id,
        "schedule_id": attachment.schedule_id,
        "file_index": attachment.file_index,
        "filename": attachment.filename,
        "mime_type": attachment.mime_type,
        "preview_kind": attachment.preview_kind,
        "plain_size_bytes": attachment.plain_size_bytes,
        "plain_sha256": attachment.plain_sha256,
        "storage_path": attachment.storage_path,
        "is_orphaned": attachment.is_orphaned,
        "created_at": attachment.created_at,
        "updated_at": attachment.updated_at,
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
        "deleted_at": schedule.deleted_at,
        "extra_fields": schedule.extra_fields,
    }


def notification_to_dict(notification: object, mentions: list[object] | None = None) -> dict[str, object]:
    """Serialize a Notification ORM instance."""
    result: dict[str, object] = {
        "id": notification.id,
        "title": notification.title,
        "description": notification.description,
        "trigger_at": notification.trigger_at,
        "created_at": notification.created_at,
        "updated_at": notification.updated_at,
        "deleted_at": notification.deleted_at,
        "extra_fields": notification.extra_fields,
    }
    if mentions is not None:
        result["mentions"] = [
            {"id": m.id, "target_type": m.target_type, "target_id": m.target_id}
            for m in mentions
        ]
    return result


def changelog_entry_to_dict(entry: object) -> dict[str, object]:
    """Serialize a changelog entry ORM instance."""
    import json
    return {
        "id": entry.id,
        "entity_id": entry.entity_id,
        "action": entry.action,
        "changed_fields": json.loads(entry.changed_fields),
        "before_snapshot": json.loads(entry.before_snapshot) if entry.before_snapshot else None,
        "after_snapshot": json.loads(entry.after_snapshot) if entry.after_snapshot else None,
        "created_at": entry.created_at,
    }


def error_to_dict(exc_type: type[BaseException], message: str) -> dict[str, object]:
    """Serialize an error to the standard error payload."""
    return {"ok": False, "error": {"type": exc_type.__name__, "message": message}}
