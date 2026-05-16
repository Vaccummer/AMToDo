"""Todo API routes."""

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
from exceptions import AMToDoError, ValidationError
from serialization import attachment_to_dict, todo_to_dict
from server.attachment_helpers import (
    build_download_response,
    check_base64_size,
    decode_base64_content,
    make_attachment_service,
    unique_targets,
    validate_attachment_limits,
)
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    TodoAttachmentDownloadRequest,
    TodoAttachmentGetRequest,
    TodoAttachmentListRequest,
    TodoAttachmentRemoveOrphanedRequest,
    TodoAttachmentRemoveRequest,
    TodoAttachmentUploadRequest,
    TodoBatchCreateRequest,
    TodoBatchUpdateRequest,
    TodoCreateRequest,
    TodoGetRequest,
    TodoListRequest,
    TodoSearchRequest,
    TodoStatsRequest,
    TodoTargetsRequest,
    TodoUpdateRequest,
)
from services import AttachmentDraft, TodoDraft, TodoService, TodoUpdate
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from models import Todo

router = APIRouter()
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


@router.post("/list")
def list_todos(
    body: TodoListRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List ToDos planned in an optional epoch range."""
    completed = _completion_filter(
        open_only=body.open_only, completed_only=body.completed_only
    )

    service = TodoService(uow.todos, clock, uow.todo_model)
    if body.start_at is None and body.end_at is None:
        todos = service.list_all(completed=completed)
    else:
        resolved_start = body.start_at if body.start_at is not None else 0
        resolved_end = body.end_at if body.end_at is not None else resolved_start + 86_400
        todos = service.list_between(resolved_start, resolved_end, completed=completed)

    result: dict[str, object] = {
        "ok": True,
        "filter": {"completed": completed},
        "count": len(todos),
        "todos": [todo_to_dict(todo, settings.timezone) for todo in todos],
    }
    if body.start_at is not None or body.end_at is not None:
        result["range"] = {"start_at": body.start_at, "end_at": body.end_at}
    return result


@router.post("/search")
def search_todos(
    body: TodoSearchRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Search ToDos with text options, filters, sorting, and pagination."""
    if body.completed is not None and (body.open_only or body.completed_only):
        raise ValidationError("completed cannot be combined with open_only/completed_only")
    completed = (
        _completion_filter(open_only=body.open_only, completed_only=body.completed_only)
        if body.open_only or body.completed_only
        else body.completed
    )
    resolved_planned_start = (
        body.planned_start_at if body.planned_start_at is not None else body.start_at
    )
    resolved_planned_end = (
        body.planned_end_at if body.planned_end_at is not None else body.end_at
    )
    service = TodoService(uow.todos, clock, uow.todo_model)
    todos = service.search(
        body.query,
        fields=body.fields,
        use_regex=body.use_regex,
        ignore_case=body.ignore_case,
        planned_start_at=resolved_planned_start,
        planned_end_at=resolved_planned_end,
        due_start_at=body.due_start_at,
        due_end_at=body.due_end_at,
        created_start_at=body.created_start_at,
        created_end_at=body.created_end_at,
        updated_start_at=body.updated_start_at,
        updated_end_at=body.updated_end_at,
        completed=completed,
        priority_min=body.priority_min,
        priority_max=body.priority_max,
        tag=body.tag,
        sort_by=body.sort_by,
        sort_order=body.sort_order,
    )
    paged = todos[body.offset:body.offset + body.limit]

    return {
        "ok": True,
        "query": body.query,
        "use_regex": body.use_regex,
        "ignore_case": body.ignore_case,
        "fields": body.fields,
        "range": {
            "planned_start_at": resolved_planned_start,
            "planned_end_at": resolved_planned_end,
            "due_start_at": body.due_start_at,
            "due_end_at": body.due_end_at,
            "created_start_at": body.created_start_at,
            "created_end_at": body.created_end_at,
            "updated_start_at": body.updated_start_at,
            "updated_end_at": body.updated_end_at,
        },
        "filter": {
            "completed": completed,
            "priority_min": body.priority_min,
            "priority_max": body.priority_max,
            "tag": body.tag,
        },
        "sort": {"by": body.sort_by, "order": body.sort_order},
        "pagination": {
            "limit": body.limit,
            "offset": body.offset,
            "has_more": body.offset + body.limit < len(todos),
        },
        "total": len(todos),
        "count": len(paged),
        "todos": [todo_to_dict(todo, settings.timezone) for todo in paged],
    }


@router.post("/stats")
def todo_stats(
    body: TodoStatsRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return ToDo statistics."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    stats = service.stats(start_at=body.start_at, end_at=body.end_at)
    return {
        "ok": True,
        "range": {"start_at": body.start_at, "end_at": body.end_at},
        "stats": stats,
    }


@router.post("/attachments/list")
def list_attachments(
    body: TodoAttachmentListRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List encrypted attachment metadata for a ToDo."""

    service = make_attachment_service(uow, clock, request, "todo")
    attachments = service.list_for_owner(body.todo_id)
    return {
        "ok": True,
        "count": len(attachments),
        "attachments": [
            attachment_to_dict(attachment, uow.user_id) for attachment in attachments
        ],
    }


@router.post("/attachments/get")
def show_attachment(
    body: TodoAttachmentGetRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return encrypted attachment metadata."""

    service = make_attachment_service(uow, clock, request, "todo")
    attachment = service.show(body.todo_id, body.attachment_id)
    return {"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/remove")
def remove_attachment(
    body: TodoAttachmentRemoveRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove an attachment from a ToDo."""

    service = make_attachment_service(uow, clock, request, "todo")
    attachment = service.remove(body.todo_id, body.attachment_id)
    return {"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/upload")
def upload_attachment_json(
    body: TodoAttachmentUploadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Upload a file attachment via encrypted JSON."""

    settings_obj = request.app.state.settings
    check_base64_size(body.content_base64, settings_obj.max_attachment_size_bytes)
    content = decode_base64_content(body.content_base64)

    validate_attachment_limits(
        settings_obj, body.todo_id, len(content), None, clock, request, "todo", uow=uow
    )

    service = make_attachment_service(uow, clock, request, "todo")
    attachment = service.create(
        body.todo_id,
        AttachmentDraft(
            filename=body.filename,
            content=content,
            mime_type=body.mime_type,
        ),
    )
    return {"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/download")
def download_attachment(
    body: TodoAttachmentDownloadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> Response:
    """Download encrypted attachment bytes."""
    service = make_attachment_service(uow, clock, request, "todo")
    return build_download_response(service, body.todo_id, body.attachment_id)


@router.post("/create")
def create_todo(
    body: TodoCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create a ToDo item."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    todo = service.create(
        TodoDraft(
            title=body.title,
            planned_at=body.planned_at,
            due_at=body.due_at,
            description=body.description,
            priority=body.priority,
            tag=body.tag,
        )
    )
    uow.session.flush()
    return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}


@router.post("/get")
def show_todo(
    body: TodoGetRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Show a ToDo by id."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    todo = service.show(body.todo_id)
    return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}


@router.post("/update")
def update_todo(
    body: TodoUpdateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update mutable ToDo fields."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    todo = service.update(
        body.todo_id,
        TodoUpdate(
            title=body.title,
            planned_at=body.planned_at,
            due_at=body.due_at,
            description=body.description,
            priority=body.priority,
            tag=body.tag,
            _fields_set=frozenset(body.model_fields_set),
        ),
    )
    uow.session.flush()
    return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}


@router.post("/done")
def done_todos(
    body: TodoTargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Mark one or more ToDos as completed."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(
            target,
            lambda current: service.complete(current),
            settings.timezone,
        )
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/reopen")
def reopen_todos(
    body: TodoTargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Mark one or more ToDos as open."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(
            target,
            lambda current: service.reopen(current),
            settings.timezone,
        )
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/remove")
def remove_todos(
    body: TodoTargetsRequest,
    request: Request,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove one or more ToDos by id."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    att_svc = make_attachment_service(uow, clock, request, "todo")

    def _remove_with_attachments(todo_id: int) -> Todo:
        for att in att_svc.list_for_owner(todo_id):
            att_svc.remove(todo_id, att.id)
        return service.remove(todo_id)

    results = [
        _target_result(
            target,
            lambda tid: _remove_with_attachments(tid),
            settings.timezone,
        )
        for target in unique_targets(body.targets)
    ]
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/batch-create")
def batch_create_todos(
    body: TodoBatchCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create multiple ToDo items. Per-item error handling."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = []
    for idx, item in enumerate(body.items):
        try:
            todo = service.create(
                TodoDraft(
                    title=item.title,
                    description=item.description,
                    planned_at=item.planned_at,
                    due_at=item.due_at,
                    priority=item.priority,
                    tag=item.tag,
                )
            )
            results.append({"target": idx, "ok": True, "todo": todo_to_dict(todo, settings.timezone)})
        except AMToDoError as exc:
            results.append({
                "target": idx,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.post("/batch-update")
def batch_update_todos(
    body: TodoBatchUpdateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update multiple ToDo items. Per-item error handling."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = []
    for idx, item in enumerate(body.items):
        try:
            todo = service.update(
                item.id,
                TodoUpdate(
                    title=item.title,
                    planned_at=item.planned_at,
                    due_at=item.due_at,
                    description=item.description,
                    priority=item.priority,
                    tag=item.tag,
                    _fields_set=frozenset(item.model_fields_set),
                ),
            )
            results.append({"target": idx, "ok": True, "todo": todo_to_dict(todo, settings.timezone)})
        except AMToDoError as exc:
            results.append({
                "target": idx,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.post("/attachments/remove-orphaned")
def remove_orphaned_attachments(
    body: TodoAttachmentRemoveOrphanedRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove orphaned attachment metadata for a ToDo."""

    service = make_attachment_service(uow, clock, request, "todo")
    count = service.remove_orphaned(body.todo_id)
    return {"ok": True, "count": count, "attachments": []}


# ── helpers ──


def _completion_filter(open_only: bool, completed_only: bool) -> bool | None:
    if open_only and completed_only:
        raise ValidationError("--open and --completed cannot be used together")
    if open_only:
        return False
    if completed_only:
        return True
    return None


def _target_result(
    target: int,
    operation: Callable[[int], Todo],
    timezone: str,
) -> dict[str, object]:
    try:
        todo = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, "todo": todo_to_dict(todo, timezone)}
