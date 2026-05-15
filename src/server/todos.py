"""Todo API routes."""

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
from config import AppSettings, amtodo_root
from exceptions import AMToDoError, ValidationError
from serialization import attachment_to_dict, todo_to_dict
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    TodoAttachmentGetRequest,
    TodoAttachmentDownloadRequest,
    TodoAttachmentListRequest,
    TodoAttachmentRemoveRequest,
    TodoAttachmentUploadRequest,
    TodoCreateRequest,
    TodoGetRequest,
    TodoListRequest,
    TodoSearchRequest,
    TodoStatsRequest,
    TodoTargetsRequest,
    TodoUpdateRequest,
)
from services import AttachmentDraft, AttachmentService, TodoDraft, TodoService, TodoUpdate
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
        resolved_end = body.end_at if body.end_at is not None else clock.now_epoch() + 86_400
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
    """Search ToDos with a regular expression."""
    completed = _completion_filter(
        open_only=body.open_only, completed_only=body.completed_only
    )
    resolved_planned_start = (
        body.planned_start_at if body.planned_start_at is not None else body.start_at
    )
    resolved_planned_end = (
        body.planned_end_at if body.planned_end_at is not None else body.end_at
    )
    service = TodoService(uow.todos, clock, uow.todo_model)
    todos = service.search(
        body.pattern,
        planned_start_at=resolved_planned_start,
        planned_end_at=resolved_planned_end,
        created_start_at=body.created_start_at,
        created_end_at=body.created_end_at,
        completed=completed,
        case_sensitive=not body.ignore_case,
    )

    return {
        "ok": True,
        "pattern": body.pattern,
        "case_sensitive": not body.ignore_case,
        "range": {
            "planned_start_at": resolved_planned_start,
            "planned_end_at": resolved_planned_end,
            "created_start_at": body.created_start_at,
            "created_end_at": body.created_end_at,
        },
        "filter": {"completed": completed},
        "count": len(todos),
        "todos": [todo_to_dict(todo, settings.timezone) for todo in todos],
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
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List encrypted attachment metadata for a ToDo."""

    service = _attachment_service(uow, clock)
    attachments = service.list_for_todo(body.todo_id)
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
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return encrypted attachment metadata."""

    service = _attachment_service(uow, clock)
    attachment = service.show(body.todo_id, body.attachment_id)
    return {"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)}


@router.post("/attachments/remove")
def remove_attachment(
    body: TodoAttachmentRemoveRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove an attachment from a ToDo."""

    service = _attachment_service(uow, clock)
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

    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except ValueError as exc:
        raise ValidationError("content_base64 must be valid base64") from exc

    _validate_attachment_limits(
        request.app.state.settings, body.todo_id, len(content), None, clock, uow=uow
    )

    service = _attachment_service(uow, clock)
    attachment = service.create(
        body.todo_id,
        AttachmentDraft(
            filename=body.filename,
            content=content,
            mime_type=body.mime_type,
        ),
    )
    uow.session.flush()
    return {"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)}


@router.post("/{todo_id}/attachments/upload")
async def upload_attachment(
    todo_id: int,
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
        service = _attachment_service(uow, clock)
        existing = service.list_for_todo(todo_id)
        if len(existing) >= settings_obj.max_attachments_per_todo:
            raise ValidationError(
                f"attachment count ({len(existing)}) already at limit "
                f"({settings_obj.max_attachments_per_todo})"
            )
        attachment = service.create(
            todo_id,
            AttachmentDraft(
                filename=file.filename or "attachment",
                content=content,
                mime_type=file.content_type,
            ),
        )
        uow.session.flush()
        attachment_id = attachment.id
        file_index = attachment.file_index
    return {
        "ok": True,
        "attachment": {
            "id": attachment_id,
            "todo_id": todo_id,
            "file_index": file_index,
            "filename": file.filename or "attachment",
        },
    }


@router.post("/attachments/download")
def download_attachment(
    body: TodoAttachmentDownloadRequest,
    request: Request,
    uow: UowDep,
    clock: ClockDep,
) -> Response:
    """Download encrypted attachment bytes."""

    service = _attachment_service(uow, clock)
    attachment = service.show(body.todo_id, body.attachment_id)
    cipher = service.read_cipher(body.todo_id, body.attachment_id)
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
        for target in _unique_targets(body.targets)
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
        for target in _unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/remove")
def remove_todos(
    body: TodoTargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove one or more ToDos by id."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(
            target,
            lambda current: service.remove(current),
            settings.timezone,
        )
        for target in _unique_targets(body.targets)
    ]
    return {"ok": all(result["ok"] for result in results), "results": results}


# ── helpers ──


def _completion_filter(open_only: bool, completed_only: bool) -> bool | None:
    if open_only and completed_only:
        raise ValidationError("--open and --completed cannot be used together")
    if open_only:
        return False
    if completed_only:
        return True
    return None


def _unique_targets(targets: list[int]) -> list[int]:
    return list(dict.fromkeys(targets))


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


def _attachment_service(uow: UnitOfWork, clock: Clock) -> AttachmentService:
    return AttachmentService(
        uow.attachments,
        uow.todos,
        clock,
        uow.attachment_model,
        amtodo_root(),
        uow.user_id,
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


def _validate_attachment_limits(
    settings: AppSettings,
    todo_id: int,
    content_size: int,
    current_count: int | None,
    clock: Clock,
    uow: UnitOfWork | None = None,
) -> None:
    if content_size > settings.max_attachment_size_bytes:
        raise ValidationError(
            f"attachment size ({content_size} bytes) exceeds limit "
            f"({settings.max_attachment_size_bytes} bytes)"
        )

    if current_count is None and uow is not None:
        service = _attachment_service(uow, clock)
        current_count = len(service.list_for_todo(todo_id))

    if current_count is not None and current_count >= settings.max_attachments_per_todo:
        raise ValidationError(
            f"attachment count ({current_count}) already at limit "
            f"({settings.max_attachments_per_todo})"
        )
