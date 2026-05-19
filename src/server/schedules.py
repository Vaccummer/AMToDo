"""Schedule API routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import (
    APIRouter,
    Depends,
    Request,
    Response,
)

from clock import Clock
from config import AppSettings
from exceptions import AMToDoError, NotFoundError
from serialization import changelog_entry_to_dict, schedule_attachment_to_dict, schedule_to_dict
from server.attachment_helpers import (
    build_download_response,
    check_base64_size,
    decode_base64_content,
    make_attachment_service,
    unique_targets,
    validate_attachment_limits,
)
from server.common import target_result as _target_result_helper
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    ScheduleAttachmentDownloadRequest,
    ScheduleAttachmentGetRequest,
    ScheduleAttachmentListRequest,
    ScheduleAttachmentRemoveOrphanedRequest,
    ScheduleAttachmentRemoveRequest,
    ScheduleAttachmentUploadRequest,
    ScheduleBatchCreateRequest,
    ScheduleBatchUpdateItem,
    ScheduleBatchUpdateRequest,
    ScheduleChangelogQueryRequest,
    ScheduleConflictsRequest,
    ScheduleCreateRequest,
    ScheduleGetRequest,
    ScheduleListRequest,
    ScheduleSearchRequest,
    ScheduleStatsRequest,
    ScheduleTargetsRequest,
    ScheduleTrashDeleteRequest,
    ScheduleTrashListRequest,
    ScheduleTrashRestoreRequest,
    ScheduleUpdateRequest,
)
from services import (
    AttachmentDraft,
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

    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
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
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
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
    if body.after_id is not None:
        cursor_idx = next((i for i, s in enumerate(schedules) if s.id == body.after_id), None)
        if cursor_idx is not None:
            schedules = schedules[cursor_idx + 1:]
    paged = schedules[:body.limit + 1]
    has_more = len(paged) > body.limit
    if has_more:
        paged = paged[:body.limit]

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
            "has_more": has_more,
            "next_cursor": paged[-1].id if has_more and paged else None,
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
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
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
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
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
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
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
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    schedule = service.show(body.schedule_id)
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.post("/update")
def update_schedule(
    body: ScheduleUpdateRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update mutable schedule fields."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    schedule = service.update(
        body.schedule_id,
        ScheduleUpdate(
            title=body.title,
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description,
            location=body.location,
            category=body.category,
            _fields_set=frozenset(body.model_fields_set) & {"title", "start_at", "end_at", "description", "location", "category"},
        ),
    )
    uow.session.flush()
    return {"ok": True, "schedule": schedule_to_dict(schedule)}


@router.post("/remove")
def remove_schedules(
    body: ScheduleTargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Soft-delete one or more schedules by id (move to trash)."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    results = [
        _target_result(target, lambda sid: service.remove(sid))
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/trash/list")
def list_deleted_schedules(
    body: ScheduleTrashListRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List deleted (trashed) schedules with search filters."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    schedules = service.list_deleted(
        start_at=body.start_at,
        end_at=body.end_at,
        created_start_at=body.created_start_at,
        created_end_at=body.created_end_at,
        updated_start_at=body.updated_start_at,
        updated_end_at=body.updated_end_at,
        category=body.category,
        location=body.location,
    )
    from services.search_common import sort_results

    if body.query:
        from services.search_common import compile_search_query, search_text
        regex = compile_search_query(body.query, use_regex=body.use_regex, ignore_case=body.ignore_case)
        resolved_fields = set(body.fields) & {"title", "description", "location", "category"}
        schedules = [s for s in schedules if regex.search(search_text(s, resolved_fields))]
    schedules = sort_results(schedules, sort_by=body.sort_by, sort_order=body.sort_order, value_fn=_schedule_sort_value)
    if body.after_id is not None:
        cursor_idx = next((i for i, s in enumerate(schedules) if s.id == body.after_id), None)
        if cursor_idx is not None:
            schedules = schedules[cursor_idx + 1:]
    paged = schedules[:body.limit + 1]
    has_more = len(paged) > body.limit
    if has_more:
        paged = paged[:body.limit]
    return {
        "ok": True,
        "total": len(schedules),
        "count": len(paged),
        "pagination": {
            "limit": body.limit,
            "has_more": has_more,
            "next_cursor": paged[-1].id if has_more and paged else None,
        },
        "schedules": [schedule_to_dict(schedule) for schedule in paged],
    }


@router.post("/trash/restore")
def restore_schedules(
    body: ScheduleTrashRestoreRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Restore one or more soft-deleted schedules."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    results = [
        _target_result(target, lambda sid: service.restore(sid))
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/trash/delete")
def purge_schedules(
    body: ScheduleTrashDeleteRequest,
    request: Request,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Permanently delete one or more soft-deleted schedules (with attachments)."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    att_svc = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)

    def _purge_with_attachments(schedule_id: int) -> Schedule:
        try:
            for att in att_svc.list_for_owner(schedule_id):
                att_svc.remove(schedule_id, att.id)
        except NotFoundError:
            pass  # owner already soft-deleted; skip attachment cleanup
        return service.purge(schedule_id)

    results = [
        _target_result(target, lambda sid: _purge_with_attachments(sid))
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/batch-create")
def batch_create_schedules(
    body: ScheduleBatchCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create multiple schedule items. Per-item error handling."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    results = []
    for idx, item in enumerate(body.items):
        try:
            schedule = service.create(
                ScheduleDraft(
                    title=item.title,
                    start_at=item.start_at,
                    end_at=item.end_at,
                    timezone=settings.timezone,
                    description=item.description,
                    location=item.location,
                    category=item.category,
                )
            )
            results.append({"target": idx, "ok": True, "schedule": schedule_to_dict(schedule)})
        except AMToDoError as exc:
            results.append({
                "target": idx,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.post("/batch-update")
def batch_update_schedules(
    body: ScheduleBatchUpdateRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update multiple schedule items. Per-item error handling."""
    service = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    results = []
    for idx, item in enumerate(body.items):
        try:
            schedule = service.update(
                item.id,
                ScheduleUpdate(
                    title=item.title,
                    start_at=item.start_at,
                    end_at=item.end_at,
                    description=item.description,
                    location=item.location,
                    category=item.category,
                    _fields_set=frozenset(item.model_fields_set) & {"title", "start_at", "end_at", "description", "location", "category"},
                ),
            )
            results.append({"target": idx, "ok": True, "schedule": schedule_to_dict(schedule)})
        except AMToDoError as exc:
            results.append({
                "target": idx,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}


# ── schedule attachments ──


@router.post("/attachments/list")
def list_attachments(
    body: ScheduleAttachmentListRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List encrypted attachment metadata for a Schedule."""

    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
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

    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
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

    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
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

    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
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
    check_base64_size(body.content_base64, settings_obj.max_attachment_size_bytes)
    content = decode_base64_content(body.content_base64)

    validate_attachment_limits(
        settings_obj, body.schedule_id, len(content), None, clock, request, "schedule", uow=uow
    )

    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
    attachment = service.create(
        body.schedule_id,
        AttachmentDraft(
            filename=body.filename,
            content=content,
            mime_type=body.mime_type,
        ),
    )
    return {"ok": True, "attachment": schedule_attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/download")
def download_attachment(
    body: ScheduleAttachmentDownloadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> Response:
    """Download encrypted schedule attachment bytes."""
    service = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)
    return build_download_response(service, body.schedule_id, body.attachment_id)


@router.post("/changelog")
def schedule_changelog(
    body: ScheduleChangelogQueryRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Query schedule changelog entries."""
    service = uow.schedule_changelog_service
    entries, total = service.query(
        entity_id=body.entity_id,
        action=body.action,
        start_at=body.start_at,
        end_at=body.end_at,
        limit=body.limit,
        after_id=body.after_id,
    )
    return {
        "ok": True,
        "total": total,
        "entries": [changelog_entry_to_dict(entry) for entry in entries],
    }


# ── helpers ──


def _target_result(
    target: int,
    operation: Callable[[int], Schedule],
) -> dict[str, object]:
    return _target_result_helper(target, operation, lambda s, **kw: {"schedule": schedule_to_dict(s)})


def _schedule_sort_value(schedule: Schedule, sort_by: str) -> object:
    """Extract sort value from a Schedule entity."""
    if sort_by == "updated_at":
        return schedule.updated_at if schedule.updated_at is not None else schedule.created_at
    if sort_by == "duration":
        return schedule.end_at - schedule.start_at
    return getattr(schedule, sort_by, None)


