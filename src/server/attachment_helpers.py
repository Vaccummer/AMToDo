"""Shared attachment helpers for todo and schedule routes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request

from clock import Clock
from config import AppSettings
from exceptions import ValidationError
from services import AttachmentService
from services.uow import UnitOfWork

if TYPE_CHECKING:
    pass


def make_attachment_service(
    uow: UnitOfWork,
    clock: Clock,
    request: Request,
    owner_type: str,
    changelog_service=None,
) -> AttachmentService:
    """Create an AttachmentService for the given owner type ('todo' or 'schedule')."""
    if owner_type == "todo":
        return AttachmentService(
            uow.attachments,
            uow.todos,
            clock,
            uow.attachment_model,
            request.app.state.attachment_root,
            uow.user_id,
            owner_type="todo",
            changelog_service=changelog_service,
        )
    return AttachmentService(
        uow.schedule_attachments,
        uow.schedules,
        clock,
        uow.schedule_attachment_model,
        request.app.state.attachment_root,
        uow.user_id,
        owner_type="schedule",
        changelog_service=changelog_service,
    )


def validate_attachment_limits(
    settings: AppSettings,
    owner_id: int,
    content_size: int,
    current_count: int | None,
    clock: Clock,
    request: Request,
    owner_type: str,
    uow: UnitOfWork | None = None,
) -> None:
    """Validate attachment size limit."""
    if content_size > settings.max_attachment_size_bytes:
        raise ValidationError(
            f"attachment size ({content_size} bytes) exceeds limit "
            f"({settings.max_attachment_size_bytes} bytes)"
        )


def unique_targets(targets: list[int]) -> list[int]:
    """De-duplicate target ids while preserving order."""
    return list(dict.fromkeys(targets))
