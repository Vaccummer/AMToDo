"""Shared attachment helpers for todo and schedule routes."""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING
from urllib.parse import quote

from fastapi import Request, Response

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


def check_base64_size(encoded: str, max_size: int) -> None:
    """Estimate decoded size from base64 length and reject oversized payloads early."""
    stripped = encoded.strip()
    padding = stripped.count("=")
    estimated = len(stripped) * 3 // 4 - padding
    if estimated > max_size:
        raise ValidationError(
            f"attachment size ~{estimated} bytes exceeds limit ({max_size} bytes)"
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
    """Validate attachment size and count limits."""
    if content_size > settings.max_attachment_size_bytes:
        raise ValidationError(
            f"attachment size ({content_size} bytes) exceeds limit "
            f"({settings.max_attachment_size_bytes} bytes)"
        )

    if current_count is None and uow is not None:
        service = make_attachment_service(uow, clock, request, owner_type)
        current_count = len(service.list_for_owner(owner_id))

    if current_count is not None and current_count >= settings.max_attachments_per_todo:
        raise ValidationError(
            f"attachment count ({current_count}) already at limit "
            f"({settings.max_attachments_per_todo})"
        )


def build_download_response(
    service: AttachmentService,
    owner_id: int,
    attachment_id: int,
) -> Response:
    """Build an encrypted attachment download response."""
    attachment = service.show(owner_id, attachment_id)
    cipher = service.read_cipher(owner_id, attachment_id)

    safe_name = attachment.filename.encode("ascii", errors="replace").decode("ascii")
    utf8_name = quote(attachment.filename, safe="")
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{safe_name}.enc"; '
            f"filename*=UTF-8''{utf8_name}.enc"
        ),
        "X-AMToDo-Cipher-SHA256": attachment.cipher_sha256,
        "X-AMToDo-Updated-At": str(attachment.updated_at),
    }
    return Response(content=cipher, media_type="application/octet-stream", headers=headers)


def decode_base64_content(encoded: str) -> bytes:
    """Decode and validate base64 content."""
    try:
        return base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValidationError("content_base64 must be valid base64") from exc


def unique_targets(targets: list[int]) -> list[int]:
    """De-duplicate target ids while preserving order."""
    return list(dict.fromkeys(targets))
