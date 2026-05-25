"""Unified trash API routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Request

from clock import Clock
from config import AppSettings
from exceptions import AMToDoError, NotFoundError, ValidationError
from serialization import (
    notification_to_dict,
    schedule_to_dict,
    todo_to_dict,
)
from server.attachment_helpers import make_attachment_service, unique_targets
from server.common import target_result as _target_result_helper
from server.deps import get_clock, get_settings, get_uow
from server.schemas import (
    TrashDeleteRequest,
    TrashGetRequest,
    TrashListRequest,
    TrashRestoreRequest,
    TrashUpdateRequest,
)
from services import (
    NotificationDraft,
    NotificationService,
    NotificationUpdate,
    ScheduleDraft,
    ScheduleService,
    ScheduleUpdate,
    TodoDraft,
    TodoService,
    TodoUpdate,
)
from services.search_common import compile_search_query, search_text, sort_results
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from models import Todo

router = APIRouter(prefix="/trash", tags=["trash"])
SettingsDep = Annotated[AppSettings, Depends(get_settings)]
UowDep = Annotated[UnitOfWork, Depends(get_uow)]
ClockDep = Annotated[Clock, Depends(get_clock)]


# ── helpers ──


def _todo_sort_value(todo: object, sort_by: str) -> object:
    if sort_by == "updated_at":
        return todo.updated_at if todo.updated_at is not None else todo.created_at
    return getattr(todo, sort_by, None)


def _schedule_sort_value(schedule: object, sort_by: str) -> object:
    if sort_by == "updated_at":
        return schedule.updated_at if schedule.updated_at is not None else schedule.created_at
    if sort_by == "duration":
        return schedule.end_at - schedule.start_at
    return getattr(schedule, sort_by, None)


def _target_result_todo(
    target: int,
    operation: Callable[[int], Todo],
    timezone: str,
) -> dict[str, object]:
    def _to_dict(todo: Todo, **kw: object) -> dict[str, object]:
        return {"todo": todo_to_dict(todo, kw["timezone"])}

    return _target_result_helper(target, operation, _to_dict, timezone=timezone)


def _target_result_schedule(
    target: int,
    operation: Callable[[int], object],
) -> dict[str, object]:
    return _target_result_helper(target, operation, lambda s, **kw: {"schedule": schedule_to_dict(s)})


# ── endpoints ──


@router.post("/get")
def trash_get(
    body: TrashGetRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Get a single trashed item."""
    if body.todo_id is not None:
        svc = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
        todo = svc.show_deleted(body.todo_id)
        return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}
    elif body.schedule_id is not None:
        svc = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
        schedule = svc.show_deleted(body.schedule_id)
        return {"ok": True, "schedule": schedule_to_dict(schedule)}
    else:
        svc = NotificationService(
            uow.notifications, uow.notification_mentions, clock,
            uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        notification = svc.show_deleted(body.notification_id)
        mentions = svc.get_mentions(notification.id)
        return {"ok": True, "notification": notification_to_dict(notification, mentions)}


@router.post("/update")
def trash_update(
    body: TrashUpdateRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Update a trashed item."""
    if body.todo_id is not None:
        svc = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
        todo_fields = {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"}
        todo = svc.update_deleted(
            body.todo_id,
            TodoUpdate(
                title=body.title,
                planned_at=body.planned_at,
                due_at=body.due_at,
                description=body.description,
                priority=body.priority,
                tag=body.tag,
                extra_fields=body.extra_fields,
                _fields_set=frozenset(body.model_fields_set) & todo_fields,
            ),
        )
        uow.session.flush()
        return {"ok": True, "todo": todo_to_dict(todo, settings.timezone)}
    elif body.schedule_id is not None:
        svc = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
        schedule_fields = {"title", "start_at", "end_at", "description", "location", "category", "extra_fields"}
        schedule = svc.update_deleted(
            body.schedule_id,
            ScheduleUpdate(
                title=body.title,
                start_at=body.start_at,
                end_at=body.end_at,
                description=body.description,
                location=body.location,
                category=body.category,
                extra_fields=body.extra_fields,
                _fields_set=frozenset(body.model_fields_set) & schedule_fields,
            ),
        )
        uow.session.flush()
        return {"ok": True, "schedule": schedule_to_dict(schedule)}
    else:
        svc = NotificationService(
            uow.notifications, uow.notification_mentions, clock,
            uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        fields_set: set[str] = set()
        if body.title is not None:
            fields_set.add("title")
        if body.description is not None:
            fields_set.add("description")
        if body.trigger_at is not None:
            fields_set.add("trigger_at")
        if body.extra_fields is not None:
            fields_set.add("extra_fields")
        if body.mentions is not None:
            fields_set.add("mentions")
        notification = svc.update_deleted(
            body.notification_id,
            NotificationUpdate(
                title=body.title,
                description=body.description,
                trigger_at=body.trigger_at,
                extra_fields=body.extra_fields,
                mentions=[{"target_type": m.target_type, "target_id": m.target_id} for m in body.mentions] if body.mentions is not None else None,
                _fields_set=frozenset(fields_set),
            ),
        )
        mentions = svc.get_mentions(notification.id)
        uow.session.flush()
        return {"ok": True, "notification": notification_to_dict(notification, mentions)}


@router.post("/list")
def trash_list(
    body: TrashListRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """List trashed items of a specific entity type."""
    entity_type = body.entity_type

    if entity_type == "todo":
        svc = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
        items = svc.list_deleted(
            planned_start_at=body.planned_start_at,
            planned_end_at=body.planned_end_at,
            due_start_at=body.due_start_at,
            due_end_at=body.due_end_at,
            created_start_at=body.created_start_at,
            created_end_at=body.created_end_at,
            updated_start_at=body.updated_start_at,
            updated_end_at=body.updated_end_at,
            completed=body.completed,
            priority_min=body.priority_min,
            priority_max=body.priority_max,
            tag=body.tag,
        )
        if body.query:
            regex = compile_search_query(body.query, use_regex=body.use_regex, ignore_case=body.ignore_case)
            resolved_fields = set(body.fields) & {"title", "description", "tag"}
            items = [t for t in items if regex.search(search_text(t, resolved_fields))]
        items = sort_results(items, sort_by=body.sort_by, sort_order=body.sort_order, value_fn=_todo_sort_value)
        if body.after_id is not None:
            cursor_idx = next((i for i, t in enumerate(items) if t.id == body.after_id), None)
            if cursor_idx is not None:
                items = items[cursor_idx + 1:]
        paged = items[:body.limit + 1]
        has_more = len(paged) > body.limit
        if has_more:
            paged = paged[:body.limit]
        return {
            "ok": True,
            "total": len(items),
            "count": len(paged),
            "pagination": {
                "limit": body.limit,
                "has_more": has_more,
                "next_cursor": paged[-1].id if has_more and paged else None,
            },
            "todos": [todo_to_dict(t, settings.timezone) for t in paged],
        }

    elif entity_type == "schedule":
        svc = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
        items = svc.list_deleted(
            start_at=body.planned_start_at,
            end_at=body.planned_end_at,
            created_start_at=body.created_start_at,
            created_end_at=body.created_end_at,
            updated_start_at=body.updated_start_at,
            updated_end_at=body.updated_end_at,
            category=body.category,
            location=body.location,
        )
        if body.query:
            regex = compile_search_query(body.query, use_regex=body.use_regex, ignore_case=body.ignore_case)
            resolved_fields = set(body.fields) & {"title", "description", "location", "category"}
            items = [s for s in items if regex.search(search_text(s, resolved_fields))]
        items = sort_results(items, sort_by=body.sort_by, sort_order=body.sort_order, value_fn=_schedule_sort_value)
        if body.after_id is not None:
            cursor_idx = next((i for i, s in enumerate(items) if s.id == body.after_id), None)
            if cursor_idx is not None:
                items = items[cursor_idx + 1:]
        paged = items[:body.limit + 1]
        has_more = len(paged) > body.limit
        if has_more:
            paged = paged[:body.limit]
        return {
            "ok": True,
            "total": len(items),
            "count": len(paged),
            "pagination": {
                "limit": body.limit,
                "has_more": has_more,
                "next_cursor": paged[-1].id if has_more and paged else None,
            },
            "schedules": [schedule_to_dict(s) for s in paged],
        }

    else:  # notification
        svc = NotificationService(
            uow.notifications, uow.notification_mentions, clock,
            uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        items = svc.list_deleted()
        mentions_map = svc.get_mentions_batch([n.id for n in items])
        result = [notification_to_dict(n, mentions_map.get(n.id, [])) for n in items]
        return {"ok": True, "count": len(result), "notifications": result}


@router.post("/restore")
def trash_restore(
    body: TrashRestoreRequest,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Restore trashed items."""
    if body.notification_id is not None:
        svc = NotificationService(
            uow.notifications, uow.notification_mentions, clock,
            uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        svc.restore(body.notification_id)
        uow.session.flush()
        return {"ok": True}

    todo_svc = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    schedule_svc = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    results = []
    for target in unique_targets(body.targets):
        try:
            todo = todo_svc.restore(target)
            results.append({"target": target, "ok": True, "todo": todo_to_dict(todo, settings.timezone)})
        except NotFoundError:
            try:
                schedule = schedule_svc.restore(target)
                results.append({"target": target, "ok": True, "schedule": schedule_to_dict(schedule)})
            except NotFoundError:
                results.append({
                    "target": target,
                    "ok": False,
                    "error": {"type": "NotFoundError", "message": f"item #{target} was not found in trash"},
                })
            except AMToDoError as exc:
                results.append({
                    "target": target,
                    "ok": False,
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                })
        except AMToDoError as exc:
            results.append({
                "target": target,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}


@router.post("/delete")
def trash_delete(
    body: TrashDeleteRequest,
    request: Request,
    settings: SettingsDep,
    uow: UowDep,
    clock: ClockDep,
) -> dict[str, object]:
    """Permanently delete trashed items."""
    if body.notification_id is not None:
        svc = NotificationService(
            uow.notifications, uow.notification_mentions, clock,
            uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )
        svc.purge(body.notification_id)
        uow.session.flush()
        return {"ok": True}

    todo_svc = TodoService(uow.todos, clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
    schedule_svc = ScheduleService(uow.schedules, clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
    todo_att_svc = make_attachment_service(uow, clock, request, "todo", changelog_service=uow.todo_changelog_service)
    schedule_att_svc = make_attachment_service(uow, clock, request, "schedule", changelog_service=uow.schedule_changelog_service)

    def _purge_todo(todo_id: int) -> Todo:
        try:
            for att in todo_att_svc.list_for_owner(todo_id):
                todo_att_svc.remove(todo_id, att.id)
        except NotFoundError:
            pass
        return todo_svc.purge(todo_id)

    def _purge_schedule(schedule_id: int) -> object:
        try:
            for att in schedule_att_svc.list_for_owner(schedule_id):
                schedule_att_svc.remove(schedule_id, att.id)
        except NotFoundError:
            pass
        return schedule_svc.purge(schedule_id)

    results = []
    for target in unique_targets(body.targets):
        try:
            todo = _purge_todo(target)
            results.append({"target": target, "ok": True, "todo": todo_to_dict(todo, settings.timezone)})
        except NotFoundError:
            try:
                schedule = _purge_schedule(target)
                results.append({"target": target, "ok": True, "schedule": schedule_to_dict(schedule)})
            except NotFoundError:
                results.append({
                    "target": target,
                    "ok": False,
                    "error": {"type": "NotFoundError", "message": f"item #{target} was not found in trash"},
                })
            except AMToDoError as exc:
                results.append({
                    "target": target,
                    "ok": False,
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                })
        except AMToDoError as exc:
            results.append({
                "target": target,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            })
    uow.session.flush()
    return {"ok": all(r["ok"] for r in results), "results": results}
