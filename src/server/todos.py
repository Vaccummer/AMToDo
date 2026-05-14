"""Todo API routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends

from clock import Clock
from config import AppSettings
from exceptions import AMToDoError, ValidationError
from serialization import todo_to_dict
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    TargetsRequest,
    TodoCreateRequest,
    TodoUpdateRequest,
)
from services import (
    TodoDraft,
    TodoService,
    TodoUpdate,
)
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from models import Todo

router = APIRouter()
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


# ── static paths (must be before parameterized paths) ──

@router.post("")
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


@router.get("")
def list_todos(
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
    start_at: int | None = None,
    end_at: int | None = None,
    open_only: bool = False,
    completed_only: bool = False,
) -> dict[str, object]:
    """List ToDos planned in an optional epoch range."""
    completed = _completion_filter(open_only=open_only, completed_only=completed_only)

    service = TodoService(uow.todos, clock, uow.todo_model)
    if start_at is None and end_at is None:
        todos = service.list_all(completed=completed)
    else:
        resolved_start_at = start_at if start_at is not None else 0
        resolved_end_at = end_at if end_at is not None else clock.now_epoch() + 86_400
        todos = service.list_between(resolved_start_at, resolved_end_at, completed=completed)

    result: dict[str, object] = {
        "ok": True,
        "filter": {"completed": completed},
        "count": len(todos),
        "todos": [todo_to_dict(todo, settings.timezone) for todo in todos],
    }
    if start_at is not None or end_at is not None:
        result["range"] = {"start_at": start_at, "end_at": end_at}
    return result


@router.get("/search")
def search_todos(
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
    pattern: str,
    start_at: int | None = None,
    end_at: int | None = None,
    planned_start_at: int | None = None,
    planned_end_at: int | None = None,
    created_start_at: int | None = None,
    created_end_at: int | None = None,
    ignore_case: bool = False,
    open_only: bool = False,
    completed_only: bool = False,
) -> dict[str, object]:
    """Search ToDos with a regular expression."""
    completed = _completion_filter(open_only=open_only, completed_only=completed_only)
    resolved_planned_start_at = planned_start_at if planned_start_at is not None else start_at
    resolved_planned_end_at = planned_end_at if planned_end_at is not None else end_at
    service = TodoService(uow.todos, clock, uow.todo_model)
    todos = service.search(
        pattern,
        planned_start_at=resolved_planned_start_at,
        planned_end_at=resolved_planned_end_at,
        created_start_at=created_start_at,
        created_end_at=created_end_at,
        completed=completed,
        case_sensitive=not ignore_case,
    )

    return {
        "ok": True,
        "pattern": pattern,
        "case_sensitive": not ignore_case,
        "range": {
            "planned_start_at": resolved_planned_start_at,
            "planned_end_at": resolved_planned_end_at,
            "created_start_at": created_start_at,
            "created_end_at": created_end_at,
        },
        "filter": {"completed": completed},
        "count": len(todos),
        "todos": [todo_to_dict(todo, settings.timezone) for todo in todos],
    }


@router.get("/stats")
def todo_stats(
    uow: UowDep,
    clock: ClockDep,
    start_at: int | None = None,
    end_at: int | None = None,
) -> dict[str, object]:
    """Return ToDo statistics."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    stats = service.stats(start_at=start_at, end_at=end_at)
    return {"ok": True, "range": {"start_at": start_at, "end_at": end_at}, "stats": stats}


@router.post("/done")
def done_todos(
    body: TargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Mark one or more ToDos as completed."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(target, lambda current: service.complete(current), settings.timezone)
        for target in _unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/reopen")
def reopen_todos(
    body: TargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Mark one or more ToDos as open."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(target, lambda current: service.reopen(current), settings.timezone)
        for target in _unique_targets(body.targets)
    ]
    uow.session.flush()
    return {"ok": all(result["ok"] for result in results), "results": results}


@router.post("/remove")
def remove_todos(
    body: TargetsRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Remove one or more ToDos by id."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    results = [
        _target_result(target, lambda current: service.remove(current), settings.timezone)
        for target in _unique_targets(body.targets)
    ]
    return {"ok": all(result["ok"] for result in results), "results": results}


# ── parameterized paths ──

@router.get("/{todo_id}")
def show_todo(
    todo_id: int,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Show a ToDo by id."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    todo = service.show(todo_id)
    return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}


@router.patch("/{todo_id}")
def update_todo(
    todo_id: int,
    body: TodoUpdateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update mutable ToDo fields."""
    service = TodoService(uow.todos, clock, uow.todo_model)
    todo = service.update(
        todo_id,
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
