"""Schedule API routes."""

from __future__ import annotations

import base64
from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)

from clock import Clock
from config import AppSettings
from exceptions import AMToDoError, ValidationError
from serialization import schedule_attachment_to_dict, schedule_to_dict
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    ScheduleAttachmentDownloadRequest,
    ScheduleAttachmentGetRequest,
    ScheduleAttachmentListRequest,
    ScheduleAttachmentRemoveOrphanedRequest,
    ScheduleAttachmentRemoveRequest,
    ScheduleAttachmentUploadRequest,
    ScheduleConflictsRequest,
    ScheduleCreateRequest,
    ScheduleGetRequest,
    ScheduleListRequest,
    ScheduleSearchRequest,
    ScheduleStatsRequest,
    ScheduleTargetsRequest,
    ScheduleUpdateRequest,
)
from services import (
    AttachmentDraft,
    AttachmentService,
    ScheduleDraft,
    ScheduleService,
    ScheduleUpdate,
)
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from models import Schedule

router = APIRouter()
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


@router.post("/list")
def list_schedules(
    body: ScheduleListRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List schedules overlapping an epoch range."""
    resolved_start_at = body.start_at if body.start_at is not None else clock.now_epoch()
    resolved_end_at = body.end_at if body.end_at is not None else resolved_start_at + 86_400

    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedules = service.list_between(resolved_start_at, resolved_end_at)

    return {
        "ok": True,
        "range": {"start_at": resolved_start_at, "end_at": resolved_end_at},
        "count": len(schedules),
        "schedules": [schedule_to_dict(schedule) for schedule in schedules],
    }


@router.post("/search")
def search_schedules(
    body: ScheduleSearchRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Search schedules with text options, filters, sorting, and pagination."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedules = service.search(
        body.query,
        fields=body.fields,
        use_regex=body.use_regex,
        ignore_case=body.ignore_case,
        start_at=body.start_at,
        end_at=body.end_at,
        created_start_at=body.created_start_at,
        created_end_at=body.created_end_at,
        updated_start_at=body.updated_start_at,
        updated_end_at=body.updated_end_at,
        category=body.category,
        location=body.location,
        sort_by=body.sort_by,
        sort_order=body.sort_order,
    )
    paged = schedules[body.offset:body.offset + body.limit]

    return {
        "ok": True,
        "query": body.query,
        "use_regex": body.use_regex,
        "ignore_case": body.ignore_case,
        "fields": body.fields,
        "range": {
            "start_at": body.start_at,
            "end_at": body.end_at,
            "created_start_at": body.created_start_at,
            "created_end_at": body.created_end_at,
            "updated_start_at": body.updated_start_at,
            "updated_end_at": body.updated_end_at,
        },
        "filter": {"category": body.category, "location": body.location},
        "sort": {"by": body.sort_by, "order": body.sort_order},
        "pagination": {
            "limit": body.limit,
            "offset": body.offset,
            "has_more": body.offset + body.limit < len(schedules),
        },
        "total": len(schedules),
        "count": len(paged),
        "schedules": [schedule_to_dict(schedule) for schedule in paged],
    }


@router.post("/stats")
def schedule_stats(
    body: ScheduleStatsRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return schedule statistics."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    stats = service.stats(start_at=body.start_at, end_at=body.end_at)
    return {
        "ok": True,
        "range": {"start_at": body.start_at, "end_at": body.end_at},
        "stats": stats,
    }


@router.post("/conflicts")
def check_conflicts(
    body: ScheduleConflictsRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Check schedule conflicts without creating an item."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    conflicts = service.conflicts(body.start_at, body.end_at, exclude_id=body.exclude_id)

    return {
        "ok": True,
        "range": {"start_at": body.start_at, "end_at": body.end_at},
        "exclude_id": body.exclude_id,
        "conflict": bool(conflicts),
        "count": len(conflicts),
        "schedules": [schedule_to_dict(schedule) for schedule in conflicts],
    }


@router.post("/create")
def create_schedule(
    body: ScheduleCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create a schedule item."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.create(
        ScheduleDraft(
            title=body.title,
            start_at=body.start_at,
            end_at=body.end_at,
            timezone=settings.timezone,
            description=body.description,
            location=body.location,
            category=body.category,
        )
    )
    uow.session.flush()
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.post("/get")
def show_schedule(
    body: ScheduleGetRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Show a schedule by id."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.show(body.schedule_id)
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.post("/update")
def update_schedule(
    body: ScheduleUpdateRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update mutable schedule fields."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    schedule = service.update(
        body.schedule_id,
        ScheduleUpdate(
            title=body.title,
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description,
            location=body.location,
            category=body.category,
            _fields_set=frozenset(body.model_fields_set),
        ),
    )
    uow.session.flush()
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.post("/remove")
def remove_schedules(
    body: ScheduleTargetsRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove one or more schedules by id."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model)
    att_svc = _schedule_attachment_service(uow, clock, request)

    def _remove_with_attachments(schedule_id: int):
        for att in att_svc.list_for_owner(schedule_id):
            att_svc.remove(schedule_id, att.id)
        return service.remove(schedule_id)

    results = [
        _target_result(target, lambda sid: _remove_with_attachments(sid))
        for target in _unique_targets(body.targets)
    ]
    return {"ok": all(result["ok"] for result in results), "results": results}


# ── schedule attachments ──


@router.post("/attachments/list")
def list_attachments(
    body: ScheduleAttachmentListRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List encrypted attachment metadata for a Schedule."""

    service = _schedule_attachment_service(uow, clock, request)
    attachments = service.list_for_owner(body.schedule_id)
    return {
        "ok": True,
        "count": len(attachments),
        "attachments": [
            schedule_attachment_to_dict(a, uow.user_id) for a in attachments
        ],
    }


@router.post("/attachments/get")
def show_attachment(
    body: ScheduleAttachmentGetRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return encrypted schedule attachment metadata."""

    service = _schedule_attachment_service(uow, clock, request)
    attachment = service.show(body.schedule_id, body.attachment_id)
    return {"ok": True, "attachment": schedule_attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/remove")
def remove_attachment(
    body: ScheduleAttachmentRemoveRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove an attachment from a Schedule."""

    service = _schedule_attachment_service(uow, clock, request)
    attachment = service.remove(body.schedule_id, body.attachment_id)
    return {"ok": True, "attachment": schedule_attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/remove-orphaned")
def remove_orphaned_attachments(
    body: ScheduleAttachmentRemoveOrphanedRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove orphaned attachment metadata for a Schedule."""

    service = _schedule_attachment_service(uow, clock, request)
    count = service.remove_orphaned(body.schedule_id)
    return {"ok": True, "count": count, "attachments": []}


@router.post("/attachments/upload")
def upload_attachment_json(
    body: ScheduleAttachmentUploadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Upload a file attachment via encrypted JSON."""

    settings_obj = request.app.state.settings
    _check_base64_size(body.content_base64, settings_obj.max_attachment_size_bytes)

    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except ValueError as exc:
        raise ValidationError("content_base64 must be valid base64") from exc

    _validate_schedule_attachment_limits(
        settings_obj, body.schedule_id, len(content), None, clock, request, uow=uow
    )

    service = _schedule_attachment_service(uow, clock, request)
    attachment = service.create(
        body.schedule_id,
        AttachmentDraft(
            filename=body.filename,
            content=content,
            mime_type=body.mime_type,
        ),
    )
    return {"ok": True, "attachment": schedule_attachment_to_dict(attachment, uow.user_id)}


@router.post("/{schedule_id}/attachments/upload")
async def upload_attachment(
    schedule_id: int,
    request: Request,
    clock: ClockDep,
    access_token: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> dict[str, object]:
    """Upload a file attachment.

    This multipart endpoint is intentionally outside JSON body encryption; the
    file is encrypted at rest immediately before it is written to disk.
    """

    user_id = _require_form_or_query_user(request, access_token)
    content = await file.read()
    settings_obj = request.app.state.settings

    if len(content) > settings_obj.max_attachment_size_bytes:
        raise ValidationError(
            f"attachment size ({len(content)} bytes) exceeds limit "
            f"({settings_obj.max_attachment_size_bytes} bytes)"
        )

    with UnitOfWork(request.app.state.db, user_id) as uow:
        service = _schedule_attachment_service(uow, clock, request)
        existing = service.list_for_owner(schedule_id)
        if len(existing) >= settings_obj.max_attachments_per_todo:
            raise ValidationError(
                f"attachment count ({len(existing)}) already at limit "
                f"({settings_obj.max_attachments_per_todo})"
            )
        attachment = service.create(
            schedule_id,
            AttachmentDraft(
                filename=file.filename or "attachment",
                content=content,
                mime_type=file.content_type,
            ),
        )
        attachment_id = attachment.id
        file_index = attachment.file_index
    return {
        "ok": True,
        "attachment": {
            "id": attachment_id,
            "schedule_id": schedule_id,
            "file_index": file_index,
            "filename": file.filename or "attachment",
        },
    }


@router.post("/attachments/download")
def download_attachment(
    body: ScheduleAttachmentDownloadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> Response:
    """Download encrypted schedule attachment bytes."""

    service = _schedule_attachment_service(uow, clock, request)
    attachment = service.show(body.schedule_id, body.attachment_id)
    cipher = service.read_cipher(body.schedule_id, body.attachment_id)
    from urllib.parse import quote

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


# ── helpers ──


def _unique_targets(targets: list[int]) -> list[int]:
    return list(dict.fromkeys(targets))


def _target_result(
    target: int,
    operation: Callable[[int], "Schedule"],
) -> dict[str, object]:
    try:
        schedule = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, "schedule": schedule_to_dict(schedule)}


def _schedule_attachment_service(uow: UnitOfWork, clock: Clock, request: Request) -> AttachmentService:
    return AttachmentService(
        uow.schedule_attachments,
        uow.schedules,
        clock,
        uow.schedule_attachment_model,
        request.app.state.attachment_root,
        uow.user_id,
        owner_type="schedule",
    )


def _check_base64_size(encoded: str, max_size: int) -> None:
    """Estimate decoded size from base64 length and reject oversized payloads early."""
    stripped = encoded.strip()
    padding = stripped.count("=")
    estimated = len(stripped) * 3 // 4 - padding
    if estimated > max_size:
        raise ValidationError(
            f"attachment size ~{estimated} bytes exceeds limit ({max_size} bytes)"
        )


def _validate_schedule_attachment_limits(
    settings: AppSettings,
    schedule_id: int,
    content_size: int,
    current_count: int | None,
    clock: Clock,
    request: Request,
    uow: UnitOfWork | None = None,
) -> None:
    if content_size > settings.max_attachment_size_bytes:
        raise ValidationError(
            f"attachment size ({content_size} bytes) exceeds limit "
            f"({settings.max_attachment_size_bytes} bytes)"
        )

    if current_count is None and uow is not None:
        service = _schedule_attachment_service(uow, clock, request)
        current_count = len(service.list_for_owner(schedule_id))

    if current_count is not None and current_count >= settings.max_attachments_per_todo:
        raise ValidationError(
            f"attachment count ({current_count}) already at limit "
            f"({settings.max_attachments_per_todo})"
        )


def _require_form_or_query_user(request: Request, access_token: str) -> int:
    token_map: dict[str, int] = request.app.state.token_map
    user_id = token_map.get(access_token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid user token",
        )
    return user_id
