"""Todo API routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)

from clock import Clock
from config import AppSettings
from exceptions import AMToDoError, NotFoundError, ValidationError
from serialization import changelog_entry_to_dict, todo_to_dict
from server.attachment_helpers import unique_targets
from server.common import target_result as _target_result_helper
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    TodoBatchCreateRequest,
    TodoBatchUpdateRequest,
    TodoChangelogQueryRequest,
    TodoCreateRequest,
    TodoGetRequest,
    TodoListRequest,
    TodoSearchRequest,
    TodoStatsRequest,
    TodoTargetsRequest,
    TodoUpdateRequest,
)
from services import TodoDraft, TodoService, TodoUpdate
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
    from sqlalchemy import func

    completed = _completion_filter(
        open_only=body.open_only, completed_only=body.completed_only
    )

    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    if body.start_at is None and body.end_at is None:
        todos = service.list_all(completed=completed)
    else:
        resolved_start = body.start_at if body.start_at is not None else 0
        resolved_end = body.end_at if body.end_at is not None else resolved_start + 86_400
        todos = service.list_between(resolved_start, resolved_end, completed=completed)

    att_model = uow.attachment_model
    att_counts: dict[int, int] = dict(
        uow.session.query(att_model.todo_id, func.count())
        .filter(att_model.todo_id.in_([t.id for t in todos]))
        .group_by(att_model.todo_id)
        .all()
    ) if todos else {}

    result: dict[str, object] = {
        "ok": True,
        "filter": {"completed": completed},
        "count": len(todos),
        "todos": [
            todo_to_dict(todo, settings.timezone, attachment_count=att_counts.get(todo.id, 0))
            for todo in todos
        ],
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
    if body.after_id is not None:
        cursor_idx = next((i for i, t in enumerate(todos) if t.id == body.after_id), None)
        if cursor_idx is not None:
            todos = todos[cursor_idx + 1:]
    paged = todos[:body.limit + 1]
    has_more = len(paged) > body.limit
    if has_more:
        paged = paged[:body.limit]

    from sqlalchemy import func as _func

    att_model = uow.attachment_model
    att_counts: dict[int, int] = dict(
        uow.session.query(att_model.todo_id, _func.count())
        .filter(att_model.todo_id.in_([t.id for t in paged]))
        .group_by(att_model.todo_id)
        .all()
    ) if paged else {}

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
            "has_more": has_more,
            "next_cursor": paged[-1].id if has_more and paged else None,
        },
        "total": len(todos),
        "count": len(paged),
        "todos": [
            todo_to_dict(todo, settings.timezone, attachment_count=att_counts.get(todo.id, 0))
            for todo in paged
        ],
    }


@router.post("/stats")
def todo_stats(
    body: TodoStatsRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Return ToDo statistics."""
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    stats = service.stats(start_at=body.start_at, end_at=body.end_at)
    return {
        "ok": True,
        "range": {"start_at": body.start_at, "end_at": body.end_at},
        "stats": stats,
    }


@router.post("/create")
def create_todo(
    body: TodoCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create a ToDo item."""
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    todo = service.create(
        TodoDraft(
            title=body.title,
            planned_at=body.planned_at,
            due_at=body.due_at,
            description=body.description,
            priority=body.priority,
            tag=body.tag,
            extra_fields=body.extra_fields,
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    todo = service.update(
        body.todo_id,
        TodoUpdate(
            title=body.title,
            planned_at=body.planned_at,
            due_at=body.due_at,
            description=body.description,
            priority=body.priority,
            tag=body.tag,
            extra_fields=body.extra_fields,
            _fields_set=frozenset(body.model_fields_set) & {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"},
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Soft-delete one or more ToDos by id (move to trash)."""
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    results = [
        _target_result(
            target,
            lambda tid: service.remove(tid),
            settings.timezone,
        )
        for target in unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/batch-create")
def batch_create_todos(
    body: TodoBatchCreateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Create multiple ToDo items. Per-item error handling."""
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
                    extra_fields=item.extra_fields,
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
    service = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
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
                    extra_fields=item.extra_fields,
                    _fields_set=frozenset(item.model_fields_set) & {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"},
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


@router.post("/changelog")
def todo_changelog(
    body: TodoChangelogQueryRequest,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Query todo changelog entries."""
    service = uow.todo_changelog_service
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


def _completion_filter(open_only: bool, completed_only: bool) -> bool | None:
    if open_only and completed_only:
        raise ValidationError("--open and --completed cannot be used together")
    if open_only:
        return False
    if completed_only:
        return True
    return None


def _todo_sort_value(todo: Todo, sort_by: str) -> object:
    """Extract sort value from a Todo entity."""
    if sort_by == "updated_at":
        return todo.updated_at if todo.updated_at is not None else todo.created_at
    return getattr(todo, sort_by, None)


def _target_result(
    target: int,
    operation: Callable[[int], Todo],
    timezone: str,
) -> dict[str, object]:
    def _to_dict(todo: Todo, **kw: object) -> dict[str, object]:
        return {"todo": todo_to_dict(todo, kw["timezone"])}  # type: ignore[arg-type]

    return _target_result_helper(target, operation, _to_dict, timezone=timezone)
