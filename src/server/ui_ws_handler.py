"""UI WebSocket message handler — dispatches WS messages to business logic.

Each handler method mirrors a REST endpoint, reusing the same service layer.
Parameter names are fully aligned with the REST API schemas.
"""

from __future__ import annotations

import base64
import logging
import time
from pathlib import Path
from typing import Any

from clock import Clock, SystemClock
from exceptions import AMToDoError, NotFoundError, ValidationError
from serialization import (
    attachment_to_dict,
    changelog_entry_to_dict,
    notification_to_dict,
    schedule_attachment_to_dict,
    schedule_to_dict,
    todo_to_dict,
    user_to_dict,
)
from services import (
    AttachmentService,
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

logger = logging.getLogger("amtodo")


class UiMessageRouter:
    """Routes UI WebSocket messages to the appropriate service methods."""

    def __init__(
        self,
        user_id: int,
        db: Any,
        settings: Any,
        attachment_root: Path,
        clock: Clock | None = None,
        upload_token_store: Any = None,
    ) -> None:
        self.user_id = user_id
        self.db = db
        self.settings = settings
        self.attachment_root = attachment_root
        self.clock = clock or SystemClock()
        self.upload_token_store = upload_token_store
        self._handlers: dict[str, Any] = {}
        self._register_all()

    def _register_all(self) -> None:
        # Todo
        self._handlers["todo.list"] = self._handle_todo_list
        self._handlers["todo.search"] = self._handle_todo_search
        self._handlers["todo.stats"] = self._handle_todo_stats
        self._handlers["todo.get"] = self._handle_todo_get
        self._handlers["todo.create"] = self._handle_todo_create
        self._handlers["todo.update"] = self._handle_todo_update
        self._handlers["todo.done"] = self._handle_todo_done
        self._handlers["todo.reopen"] = self._handle_todo_reopen
        self._handlers["todo.remove"] = self._handle_todo_remove
        self._handlers["todo.batch.create"] = self._handle_todo_batch_create
        self._handlers["todo.batch.update"] = self._handle_todo_batch_update
        # Unified trash
        self._handlers["trash.get"] = self._handle_trash_get
        self._handlers["trash.update"] = self._handle_trash_update
        self._handlers["trash.list"] = self._handle_trash_list
        self._handlers["trash.restore"] = self._handle_trash_restore
        self._handlers["trash.delete"] = self._handle_trash_delete
        # Entity-specific trash (delegate to unified handlers)
        self._handlers["todo.trash.get"] = self._handle_trash_get
        self._handlers["todo.trash.update"] = self._handle_trash_update
        self._handlers["todo.trash.list"] = self._handle_todo_trash_list
        self._handlers["schedule.trash.get"] = self._handle_trash_get
        self._handlers["schedule.trash.update"] = self._handle_trash_update
        self._handlers["schedule.trash.list"] = self._handle_schedule_trash_list
        self._handlers["notification.trash.get"] = self._handle_trash_get
        self._handlers["notification.trash.update"] = self._handle_trash_update
        self._handlers["notification.trash.list"] = self._handle_notification_trash_list
        # Schedule
        self._handlers["schedule.list"] = self._handle_schedule_list
        self._handlers["schedule.search"] = self._handle_schedule_search
        self._handlers["schedule.stats"] = self._handle_schedule_stats
        self._handlers["schedule.conflicts"] = self._handle_schedule_conflicts
        self._handlers["schedule.get"] = self._handle_schedule_get
        self._handlers["schedule.create"] = self._handle_schedule_create
        self._handlers["schedule.update"] = self._handle_schedule_update
        self._handlers["schedule.remove"] = self._handle_schedule_remove
        self._handlers["schedule.batch.create"] = self._handle_schedule_batch_create
        self._handlers["schedule.batch.update"] = self._handle_schedule_batch_update
        # Notification
        self._handlers["notification.list"] = self._handle_notification_list
        self._handlers["notification.list_triggered"] = self._handle_notification_list_triggered
        self._handlers["notification.get"] = self._handle_notification_get
        self._handlers["notification.create"] = self._handle_notification_create
        self._handlers["notification.update"] = self._handle_notification_update
        self._handlers["notification.remove"] = self._handle_notification_remove
        # Attachment
        self._handlers["attachment.list"] = self._handle_attachment_list
        self._handlers["attachment.get"] = self._handle_attachment_get
        self._handlers["attachment.init_upload"] = self._handle_init_upload
        self._handlers["attachment.download_chunk"] = self._handle_download_chunk
        self._handlers["attachment.remove"] = self._handle_attachment_remove
        self._handlers["attachment.remove_orphaned"] = self._handle_attachment_remove_orphaned
        self._handlers["attachment.rename"] = self._handle_attachment_rename
        # Changelog
        self._handlers["todo.changelog"] = self._handle_todo_changelog
        self._handlers["schedule.changelog"] = self._handle_schedule_changelog
        self._handlers["notification.changelog"] = self._handle_notification_changelog
        self._handlers["user"] = self._handle_user

    async def route(self, msg_type: str, payload: dict[str, Any] | None) -> Any:
        """Dispatch a message to the registered handler."""
        handler = self._handlers.get(msg_type)
        if handler is None:
            raise ValidationError(f"Unknown message type: {msg_type}")
        return handler(payload or {})

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _uow(self) -> UnitOfWork:
        return UnitOfWork(self.db, self.user_id)

    def _make_attachment_service(self, uow: UnitOfWork, owner_type: str, changelog_service=None) -> AttachmentService:
        if owner_type == "todo":
            return AttachmentService(
                uow.attachments, uow.todos, self.clock,
                uow.attachment_model, self.attachment_root,
                self.user_id, owner_type="todo",
                changelog_service=changelog_service,
            )
        return AttachmentService(
            uow.schedule_attachments, uow.schedules, self.clock,
            uow.schedule_attachment_model, self.attachment_root,
            self.user_id, owner_type="schedule",
            changelog_service=changelog_service,
        )

    def _make_notification_service(self, uow: UnitOfWork) -> NotificationService:
        return NotificationService(
            uow.notifications, uow.notification_mentions,
            self.clock, uow.notification_model, uow.notification_mention_model,
            changelog_service=uow.notification_changelog_service,
        )

    def _resolve_attachment_owner(self, p: dict) -> tuple[str, int]:
        """Resolve owner_type and owner_id from attachment payload."""
        has_todo = "todo_id" in p
        has_schedule = "schedule_id" in p
        if has_todo and has_schedule:
            raise ValidationError("Cannot specify both todo_id and schedule_id")
        if has_todo:
            return "todo", p["todo_id"]
        if has_schedule:
            return "schedule", p["schedule_id"]
        raise ValidationError("Missing todo_id or schedule_id")

    @staticmethod
    def _completion_filter(open_only: bool, completed_only: bool) -> bool | None:
        if open_only and completed_only:
            raise ValidationError("open_only and completed_only cannot be used together")
        if open_only:
            return False
        if completed_only:
            return True
        return None

    # ------------------------------------------------------------------
    # Todo handlers
    # ------------------------------------------------------------------

    def _handle_todo_list(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            completed = self._completion_filter(
                open_only=p.get("open_only", False),
                completed_only=p.get("completed_only", False),
            )
            start_at = p.get("start_at")
            end_at = p.get("end_at")
            if start_at is None and end_at is None:
                todos = svc.list_all(completed=completed)
            else:
                resolved_start = start_at if start_at is not None else 0
                resolved_end = end_at if end_at is not None else resolved_start + 86_400
                todos = svc.list_between(resolved_start, resolved_end, completed=completed)
            att_counts = _bulk_attachment_counts(uow, "todo", [t.id for t in todos])
            return {
                "ok": True,
                "count": len(todos),
                "todos": [todo_to_dict(t, self.settings.timezone, attachment_count=att_counts.get(t.id, 0)) for t in todos],
            }

    def _handle_todo_search(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            open_only = p.get("open_only", False)
            completed_only = p.get("completed_only", False)
            if p.get("completed") is not None and (open_only or completed_only):
                raise ValidationError("completed cannot be combined with open_only/completed_only")
            completed = (
                self._completion_filter(open_only=open_only, completed_only=completed_only)
                if open_only or completed_only
                else p.get("completed")
            )
            resolved_planned_start = (
                p["planned_start_at"] if p.get("planned_start_at") is not None else p.get("start_at")
            )
            resolved_planned_end = (
                p["planned_end_at"] if p.get("planned_end_at") is not None else p.get("end_at")
            )
            todos = svc.search(
                p.get("query", ""),
                fields=p.get("fields", ["title", "description", "tag"]),
                use_regex=p.get("use_regex", False),
                ignore_case=p.get("ignore_case", True),
                planned_start_at=resolved_planned_start,
                planned_end_at=resolved_planned_end,
                due_start_at=p.get("due_start_at"),
                due_end_at=p.get("due_end_at"),
                created_start_at=p.get("created_start_at"),
                created_end_at=p.get("created_end_at"),
                updated_start_at=p.get("updated_start_at"),
                updated_end_at=p.get("updated_end_at"),
                completed=completed,
                priority_min=p.get("priority_min"),
                priority_max=p.get("priority_max"),
                tag=p.get("tag"),
                sort_by=p.get("sort_by", "updated_at"),
                sort_order=p.get("sort_order", "desc"),
            )
            limit = p.get("limit", 50)
            after_id = p.get("after_id")
            if after_id is not None:
                cursor_idx = next((i for i, t in enumerate(todos) if t.id == after_id), None)
                if cursor_idx is not None:
                    todos = todos[cursor_idx + 1:]
            paged = todos[:limit + 1]
            has_more = len(paged) > limit
            if has_more:
                paged = paged[:limit]
            att_counts = _bulk_attachment_counts(uow, "todo", [t.id for t in paged])
            return {
                "ok": True,
                "todos": [todo_to_dict(t, self.settings.timezone, attachment_count=att_counts.get(t.id, 0)) for t in paged],
                "total": len(todos),
                "has_more": has_more,
                "next_cursor": paged[-1].id if has_more and paged else None,
            }

    def _handle_todo_stats(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            stats = svc.stats(start_at=p.get("start_at"), end_at=p.get("end_at"))
            return {"ok": True, "range": {"start_at": p.get("start_at"), "end_at": p.get("end_at")}, "stats": stats}

    def _handle_todo_get(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            todo = svc.show(p["todo_id"])
            return {"ok": True, "todo": todo_to_dict(todo, self.settings.timezone)}

    def _handle_todo_create(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            todo = svc.create(TodoDraft(
                title=p["title"],
                planned_at=p.get("planned_at"),
                due_at=p.get("due_at"),
                description=p.get("description"),
                priority=p.get("priority", 0),
                tag=p.get("tag"),
                extra_fields=p.get("extra_fields"),
            ))
            uow.session.flush()
            return {"ok": True, "todo": todo_to_dict(todo, self.settings.timezone)}

    def _handle_todo_update(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            fields = (set(p.keys()) - {"todo_id"}) & {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"}
            todo = svc.update(p["todo_id"], TodoUpdate(
                title=p.get("title"),
                planned_at=p.get("planned_at"),
                due_at=p.get("due_at"),
                description=p.get("description"),
                priority=p.get("priority"),
                tag=p.get("tag"),
                extra_fields=p.get("extra_fields"),
                _fields_set=frozenset(fields),
            ))
            uow.session.flush()
            return {"ok": True, "todo": todo_to_dict(todo, self.settings.timezone)}

    def _handle_todo_done(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            targets = _unique_targets(p["targets"])
            results = []
            for tid in targets:
                try:
                    todo = svc.complete(tid)
                    results.append({"target": tid, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except AMToDoError as exc:
                    results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_todo_reopen(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            targets = _unique_targets(p["targets"])
            results = []
            for tid in targets:
                try:
                    todo = svc.reopen(tid)
                    results.append({"target": tid, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except AMToDoError as exc:
                    results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_todo_remove(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            targets = _unique_targets(p["targets"])
            results = []
            for tid in targets:
                try:
                    todo = svc.remove(tid)
                    results.append({"target": tid, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except AMToDoError as exc:
                    results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_todo_batch_create(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            results = []
            for idx, item in enumerate(p["items"]):
                try:
                    todo = svc.create(TodoDraft(
                        title=item["title"],
                        planned_at=item.get("planned_at"),
                        due_at=item.get("due_at"),
                        description=item.get("description"),
                        priority=item.get("priority", 0),
                        tag=item.get("tag"),
                        extra_fields=item.get("extra_fields"),
                    ))
                    results.append({"target": idx, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except AMToDoError as exc:
                    results.append({"target": idx, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_todo_batch_update(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            results = []
            for idx, item in enumerate(p["items"]):
                try:
                    fields = (set(item.keys()) - {"id"}) & {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"}
                    todo = svc.update(item["id"], TodoUpdate(
                        title=item.get("title"),
                        planned_at=item.get("planned_at"),
                        due_at=item.get("due_at"),
                        description=item.get("description"),
                        priority=item.get("priority"),
                        tag=item.get("tag"),
                        extra_fields=item.get("extra_fields"),
                        _fields_set=frozenset(fields),
                    ))
                    results.append({"target": idx, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except AMToDoError as exc:
                    results.append({"target": idx, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    # ------------------------------------------------------------------
    # Unified trash handlers
    # ------------------------------------------------------------------

    def _handle_trash_get(self, p: dict) -> dict:
        if p.get("todo_id") is not None:
            with self._uow() as uow:
                svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
                todo = svc.show_deleted(p["todo_id"])
                return {"ok": True, "todo": todo_to_dict(todo, self.settings.timezone)}
        elif p.get("schedule_id") is not None:
            with self._uow() as uow:
                svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
                schedule = svc.show_deleted(p["schedule_id"])
                return {"ok": True, "schedule": schedule_to_dict(schedule)}
        elif p.get("notification_id") is not None:
            with self._uow() as uow:
                svc = self._make_notification_service(uow)
                notification = svc.show_deleted(p["notification_id"])
                mentions = svc.get_mentions(notification.id)
                return {"ok": True, "notification": notification_to_dict(notification, mentions)}
        return {"ok": False, "error": "exactly one of todo_id, schedule_id, notification_id required"}

    def _handle_trash_update(self, p: dict) -> dict:
        if p.get("todo_id") is not None:
            with self._uow() as uow:
                svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
                fields = (set(p.keys()) - {"todo_id"}) & {"title", "planned_at", "due_at", "description", "priority", "tag", "extra_fields"}
                todo = svc.update_deleted(p["todo_id"], TodoUpdate(
                    title=p.get("title"),
                    planned_at=p.get("planned_at"),
                    due_at=p.get("due_at"),
                    description=p.get("description"),
                    priority=p.get("priority"),
                    tag=p.get("tag"),
                    extra_fields=p.get("extra_fields"),
                    _fields_set=frozenset(fields),
                ))
                uow.session.flush()
                return {"ok": True, "todo": todo_to_dict(todo, self.settings.timezone)}
        elif p.get("schedule_id") is not None:
            with self._uow() as uow:
                svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
                fields = (set(p.keys()) - {"schedule_id"}) & {"title", "start_at", "end_at", "description", "location", "category", "extra_fields"}
                schedule = svc.update_deleted(p["schedule_id"], ScheduleUpdate(
                    title=p.get("title"),
                    start_at=p.get("start_at"),
                    end_at=p.get("end_at"),
                    description=p.get("description"),
                    location=p.get("location"),
                    category=p.get("category"),
                    extra_fields=p.get("extra_fields"),
                    _fields_set=frozenset(fields),
                ))
                uow.session.flush()
                return {"ok": True, "schedule": schedule_to_dict(schedule)}
        elif p.get("notification_id") is not None:
            with self._uow() as uow:
                svc = self._make_notification_service(uow)
                fields_set: set[str] = set()
                if "title" in p:
                    fields_set.add("title")
                if "description" in p:
                    fields_set.add("description")
                if "trigger_at" in p:
                    fields_set.add("trigger_at")
                if "extra_fields" in p:
                    fields_set.add("extra_fields")
                if "mentions" in p:
                    fields_set.add("mentions")
                update = NotificationUpdate(
                    title=p.get("title"),
                    description=p.get("description"),
                    trigger_at=p.get("trigger_at"),
                    extra_fields=p.get("extra_fields"),
                    mentions=p.get("mentions"),
                    _fields_set=frozenset(fields_set),
                )
                notification = svc.update_deleted(p["notification_id"], update)
                mentions = svc.get_mentions(notification.id)
                uow.session.flush()
                return {"ok": True, "notification": notification_to_dict(notification, mentions)}
        return {"ok": False, "error": "exactly one of todo_id, schedule_id, notification_id required"}

    def _handle_trash_list(self, p: dict) -> dict:
        entity_type = p.get("entity_type", "todo")
        if entity_type == "todo":
            with self._uow() as uow:
                svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
                todos = svc.list_deleted(
                    planned_start_at=p.get("planned_start_at"),
                    planned_end_at=p.get("planned_end_at"),
                    due_start_at=p.get("due_start_at"),
                    due_end_at=p.get("due_end_at"),
                    created_start_at=p.get("created_start_at"),
                    created_end_at=p.get("created_end_at"),
                    updated_start_at=p.get("updated_start_at"),
                    updated_end_at=p.get("updated_end_at"),
                    completed=p.get("completed"),
                    priority_min=p.get("priority_min"),
                    priority_max=p.get("priority_max"),
                    tag=p.get("tag"),
                )
                query = p.get("query", "")
                if query:
                    regex = compile_search_query(query, use_regex=p.get("use_regex", False), ignore_case=p.get("ignore_case", True))
                    resolved_fields = set(p.get("fields", ["title", "description"])) & {"title", "description", "tag"}
                    todos = [t for t in todos if regex.search(search_text(t, resolved_fields))]
                todos = sort_results(todos, sort_by=p.get("sort_by", "updated_at"), sort_order=p.get("sort_order", "desc"), value_fn=_todo_sort_value)
                limit = p.get("limit", 50)
                after_id = p.get("after_id")
                if after_id is not None:
                    cursor_idx = next((i for i, t in enumerate(todos) if t.id == after_id), None)
                    if cursor_idx is not None:
                        todos = todos[cursor_idx + 1:]
                paged = todos[:limit + 1]
                has_more = len(paged) > limit
                if has_more:
                    paged = paged[:limit]
                return {
                    "ok": True,
                    "total": len(todos),
                    "count": len(paged),
                    "todos": [todo_to_dict(t, self.settings.timezone) for t in paged],
                    "has_more": has_more,
                    "next_cursor": paged[-1].id if has_more and paged else None,
                }
        elif entity_type == "schedule":
            with self._uow() as uow:
                svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
                schedules = svc.list_deleted(
                    start_at=p.get("planned_start_at"),
                    end_at=p.get("planned_end_at"),
                    created_start_at=p.get("created_start_at"),
                    created_end_at=p.get("created_end_at"),
                    updated_start_at=p.get("updated_start_at"),
                    updated_end_at=p.get("updated_end_at"),
                    category=p.get("category"),
                    location=p.get("location"),
                )
                query = p.get("query", "")
                if query:
                    regex = compile_search_query(query, use_regex=p.get("use_regex", False), ignore_case=p.get("ignore_case", True))
                    resolved_fields = set(p.get("fields", ["title", "description"])) & {"title", "description", "location", "category"}
                    schedules = [s for s in schedules if regex.search(search_text(s, resolved_fields))]
                schedules = sort_results(schedules, sort_by=p.get("sort_by", "updated_at"), sort_order=p.get("sort_order", "desc"), value_fn=_schedule_sort_value)
                limit = p.get("limit", 50)
                after_id = p.get("after_id")
                if after_id is not None:
                    cursor_idx = next((i for i, s in enumerate(schedules) if s.id == after_id), None)
                    if cursor_idx is not None:
                        schedules = schedules[cursor_idx + 1:]
                paged = schedules[:limit + 1]
                has_more = len(paged) > limit
                if has_more:
                    paged = paged[:limit]
                return {
                    "ok": True,
                    "total": len(schedules),
                    "count": len(paged),
                    "schedules": [schedule_to_dict(s) for s in paged],
                    "has_more": has_more,
                    "next_cursor": paged[-1].id if has_more and paged else None,
                }
        else:  # notification
            with self._uow() as uow:
                svc = self._make_notification_service(uow)
                notifications = svc.list_deleted()
                mentions_map = svc.get_mentions_batch([n.id for n in notifications])
                result = [notification_to_dict(n, mentions_map.get(n.id, [])) for n in notifications]
                return {"ok": True, "count": len(result), "notifications": result}

    def _handle_trash_restore(self, p: dict) -> dict:
        if p.get("notification_id") is not None:
            with self._uow() as uow:
                svc = self._make_notification_service(uow)
                svc.restore(p["notification_id"])
                uow.session.flush()
                return {"ok": True}
        targets = _unique_targets(p.get("targets", []))
        with self._uow() as uow:
            todo_svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            schedule_svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            results = []
            for tid in targets:
                try:
                    todo = todo_svc.restore(tid)
                    results.append({"target": tid, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except NotFoundError:
                    try:
                        schedule = schedule_svc.restore(tid)
                        results.append({"target": tid, "ok": True, "schedule": schedule_to_dict(schedule)})
                    except NotFoundError:
                        results.append({"target": tid, "ok": False, "error": {"type": "NotFoundError", "message": f"item #{tid} was not found in trash"}})
                    except AMToDoError as exc:
                        results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
                except AMToDoError as exc:
                    results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_trash_delete(self, p: dict) -> dict:
        if p.get("notification_id") is not None:
            with self._uow() as uow:
                svc = self._make_notification_service(uow)
                svc.purge(p["notification_id"])
                uow.session.flush()
                return {"ok": True}
        targets = _unique_targets(p.get("targets", []))
        with self._uow() as uow:
            todo_svc = TodoService(uow.todos, self.clock, uow.todo_model, changelog_service=uow.todo_changelog_service)
            schedule_svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            todo_att_svc = self._make_attachment_service(uow, "todo", changelog_service=uow.todo_changelog_service)
            schedule_att_svc = self._make_attachment_service(uow, "schedule", changelog_service=uow.schedule_changelog_service)
            results = []
            for tid in targets:
                try:
                    for att in todo_att_svc.list_for_owner(tid):
                        todo_att_svc.remove(tid, att.id)
                except (NotFoundError, AMToDoError):
                    pass
                try:
                    todo = todo_svc.purge(tid)
                    results.append({"target": tid, "ok": True, "todo": todo_to_dict(todo, self.settings.timezone)})
                except NotFoundError:
                    try:
                        for att in schedule_att_svc.list_for_owner(tid):
                            schedule_att_svc.remove(tid, att.id)
                    except (NotFoundError, AMToDoError):
                        pass
                    try:
                        schedule = schedule_svc.purge(tid)
                        results.append({"target": tid, "ok": True, "schedule": schedule_to_dict(schedule)})
                    except NotFoundError:
                        results.append({"target": tid, "ok": False, "error": {"type": "NotFoundError", "message": f"item #{tid} was not found in trash"}})
                    except AMToDoError as exc:
                        results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
                except AMToDoError as exc:
                    results.append({"target": tid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_todo_trash_list(self, p: dict) -> dict:
        p.setdefault("entity_type", "todo")
        return self._handle_trash_list(p)

    def _handle_schedule_trash_list(self, p: dict) -> dict:
        p.setdefault("entity_type", "schedule")
        return self._handle_trash_list(p)

    def _handle_notification_trash_list(self, p: dict) -> dict:
        p.setdefault("entity_type", "notification")
        return self._handle_trash_list(p)

    # ------------------------------------------------------------------
    # Schedule handlers
    # ------------------------------------------------------------------

    def _handle_schedule_list(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            start_at = p.get("start_at") if p.get("start_at") is not None else self.clock.now_epoch()
            end_at = p.get("end_at") if p.get("end_at") is not None else start_at + 86_400
            schedules = svc.list_between(start_at, end_at)
            return {
                "ok": True,
                "count": len(schedules),
                "schedules": [schedule_to_dict(s) for s in schedules],
            }

    def _handle_schedule_search(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            schedules = svc.search(
                p.get("query", ""),
                fields=p.get("fields", ["title", "description", "location", "category"]),
                use_regex=p.get("use_regex", False),
                ignore_case=p.get("ignore_case", True),
                start_at=p.get("start_at"),
                end_at=p.get("end_at"),
                created_start_at=p.get("created_start_at"),
                created_end_at=p.get("created_end_at"),
                updated_start_at=p.get("updated_start_at"),
                updated_end_at=p.get("updated_end_at"),
                category=p.get("category"),
                location=p.get("location"),
                sort_by=p.get("sort_by", "updated_at"),
                sort_order=p.get("sort_order", "desc"),
            )
            limit = p.get("limit", 50)
            after_id = p.get("after_id")
            if after_id is not None:
                cursor_idx = next((i for i, s in enumerate(schedules) if s.id == after_id), None)
                if cursor_idx is not None:
                    schedules = schedules[cursor_idx + 1:]
            paged = schedules[:limit + 1]
            has_more = len(paged) > limit
            if has_more:
                paged = paged[:limit]
            return {
                "ok": True,
                "schedules": [schedule_to_dict(s) for s in paged],
                "total": len(schedules),
                "has_more": has_more,
                "next_cursor": paged[-1].id if has_more and paged else None,
            }

    def _handle_schedule_stats(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            stats = svc.stats(start_at=p.get("start_at"), end_at=p.get("end_at"))
            return {"ok": True, "range": {"start_at": p.get("start_at"), "end_at": p.get("end_at")}, "stats": stats}

    def _handle_schedule_conflicts(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            conflicts = svc.conflicts(p["start_at"], p["end_at"], exclude_id=p.get("exclude_id"))
            return {
                "ok": True,
                "range": {"start_at": p["start_at"], "end_at": p["end_at"]},
                "exclude_id": p.get("exclude_id"),
                "conflict": bool(conflicts),
                "count": len(conflicts),
                "schedules": [schedule_to_dict(s) for s in conflicts],
            }

    def _handle_schedule_get(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            schedule = svc.show(p["schedule_id"])
            return {"ok": True, "schedule": schedule_to_dict(schedule)}

    def _handle_schedule_create(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            schedule = svc.create(ScheduleDraft(
                title=p["title"],
                start_at=p["start_at"],
                end_at=p["end_at"],
                timezone=self.settings.timezone,
                description=p.get("description"),
                location=p.get("location"),
                category=p.get("category"),
            ))
            uow.session.flush()
            return {"ok": True, "schedule": schedule_to_dict(schedule)}

    def _handle_schedule_update(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            fields = (set(p.keys()) - {"schedule_id"}) & {"title", "start_at", "end_at", "description", "location", "category", "extra_fields"}
            schedule = svc.update(p["schedule_id"], ScheduleUpdate(
                title=p.get("title"),
                start_at=p.get("start_at"),
                end_at=p.get("end_at"),
                description=p.get("description"),
                location=p.get("location"),
                category=p.get("category"),
                extra_fields=p.get("extra_fields"),
                _fields_set=frozenset(fields),
            ))
            uow.session.flush()
            return {"ok": True, "schedule": schedule_to_dict(schedule)}

    def _handle_schedule_remove(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            targets = _unique_targets(p["targets"])
            results = []
            for sid in targets:
                try:
                    schedule = svc.remove(sid)
                    results.append({"target": sid, "ok": True, "schedule": schedule_to_dict(schedule)})
                except AMToDoError as exc:
                    results.append({"target": sid, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_schedule_batch_create(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            results = []
            for idx, item in enumerate(p["items"]):
                try:
                    schedule = svc.create(ScheduleDraft(
                        title=item["title"],
                        start_at=item["start_at"],
                        end_at=item["end_at"],
                        timezone=self.settings.timezone,
                        description=item.get("description"),
                        location=item.get("location"),
                        category=item.get("category"),
                    ))
                    results.append({"target": idx, "ok": True, "schedule": schedule_to_dict(schedule)})
                except AMToDoError as exc:
                    results.append({"target": idx, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    def _handle_schedule_batch_update(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = ScheduleService(uow.schedules, self.clock, uow.schedule_model, changelog_service=uow.schedule_changelog_service)
            results = []
            for idx, item in enumerate(p["items"]):
                try:
                    fields = (set(item.keys()) - {"id"}) & {"title", "start_at", "end_at", "description", "location", "category"}
                    schedule = svc.update(item["id"], ScheduleUpdate(
                        title=item.get("title"),
                        start_at=item.get("start_at"),
                        end_at=item.get("end_at"),
                        description=item.get("description"),
                        location=item.get("location"),
                        category=item.get("category"),
                        _fields_set=frozenset(fields),
                    ))
                    results.append({"target": idx, "ok": True, "schedule": schedule_to_dict(schedule)})
                except AMToDoError as exc:
                    results.append({"target": idx, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
            uow.session.flush()
            return {"ok": all(r["ok"] for r in results), "results": results}

    # ------------------------------------------------------------------
    # Notification handlers
    # ------------------------------------------------------------------

    def _handle_notification_list(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            notifications = svc.list_between(p["start_at"], p["end_at"])
            mentions_map = svc.get_mentions_batch([n.id for n in notifications])
            result = [notification_to_dict(n, mentions_map.get(n.id, [])) for n in notifications]
            return {"ok": True, "count": len(result), "notifications": result}

    def _handle_notification_list_triggered(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            now = int(time.time())
            notifications = svc.list_triggered(p["after"], now)
            mentions_map = svc.get_mentions_batch([n.id for n in notifications])
            result = [notification_to_dict(n, mentions_map.get(n.id, [])) for n in notifications]
            return {"ok": True, "count": len(result), "notifications": result}

    def _handle_notification_get(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            notification = svc.show(p["notification_id"])
            mentions = svc.get_mentions(notification.id)
            return {"ok": True, "notification": notification_to_dict(notification, mentions)}

    def _handle_notification_create(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            draft = NotificationDraft(
                title=p["title"],
                trigger_at=p["trigger_at"],
                description=p.get("description"),
                mentions=p.get("mentions", []),
            )
            notification = svc.create(draft)
            mentions = svc.get_mentions(notification.id)
            return {"ok": True, "notification": notification_to_dict(notification, mentions)}

    def _handle_notification_update(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            fields_set: set[str] = set()
            if "title" in p:
                fields_set.add("title")
            if "description" in p:
                fields_set.add("description")
            if "trigger_at" in p:
                fields_set.add("trigger_at")
            if "mentions" in p:
                fields_set.add("mentions")
            update = NotificationUpdate(
                title=p.get("title"),
                description=p.get("description"),
                trigger_at=p.get("trigger_at"),
                mentions=p.get("mentions"),
                _fields_set=frozenset(fields_set),
            )
            notification = svc.update(p["notification_id"], update)
            mentions = svc.get_mentions(notification.id)
            return {"ok": True, "notification": notification_to_dict(notification, mentions)}

    def _handle_notification_remove(self, p: dict) -> dict:
        with self._uow() as uow:
            svc = self._make_notification_service(uow)
            svc.remove(p["notification_id"])
            return {"ok": True}

    # ------------------------------------------------------------------
    # Attachment handlers
    # ------------------------------------------------------------------

    def _handle_attachment_list(self, p: dict) -> dict:
        with self._uow() as uow:
            owner_type, owner_id = self._resolve_attachment_owner(p)
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            attachments = svc.list_for_owner(owner_id)
            dict_fn = attachment_to_dict if owner_type == "todo" else schedule_attachment_to_dict
            result = [dict_fn(a, self.user_id) for a in attachments]
            return {"ok": True, "count": len(result), "attachments": result}

    def _handle_attachment_get(self, p: dict) -> dict:
        with self._uow() as uow:
            owner_type, owner_id = self._resolve_attachment_owner(p)
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            attachment = svc.show(owner_id, p["attachment_id"])
            dict_fn = attachment_to_dict if owner_type == "todo" else schedule_attachment_to_dict
            return {"ok": True, "attachment": dict_fn(attachment, self.user_id)}

    def _handle_init_upload(self, p: dict) -> dict:
        owner_type = p["owner_type"]
        owner_id = p["owner_id"]

        with self._uow() as uow:
            svc = self._make_attachment_service(uow, owner_type)
            # Validate owner exists
            svc.list_for_owner(owner_id)

        if self.upload_token_store is None:
            raise ValidationError("upload token store not configured")

        token = self.upload_token_store.create(
            owner_type=owner_type,
            owner_id=owner_id,
            user_id=self.user_id,
            filename=p["filename"],
            mime_type=p.get("mime_type"),
            plain_size=p["plain_size"],
            plain_sha256=p.get("plain_sha256"),
        )
        return {"ok": True, "token": token}

    def _handle_download_chunk(self, p: dict) -> dict:
        owner_type = p["owner_type"]
        owner_id = p["owner_id"]
        attachment_id = p["attachment_id"]
        offset = max(int(p.get("offset", 0)), 0)
        length = min(max(int(p.get("length", 262144)), 1), 1048576)

        with self._uow() as uow:
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            attachment = svc.show(owner_id, attachment_id)
            content_path = svc.storage_path(attachment)
            if not content_path.is_file():
                raise ValidationError("attachment file was not found")
            file_size = content_path.stat().st_size
            if offset > file_size:
                raise ValidationError("download offset is out of range")
            with open(content_path, "rb") as f:
                f.seek(offset)
                chunk = f.read(length)

        bytes_read = len(chunk)
        next_offset = offset + bytes_read
        return {
            "ok": True,
            "offset": offset,
            "bytes_read": bytes_read,
            "next_offset": next_offset,
            "file_size": file_size,
            "done": next_offset >= file_size,
            "data": base64.b64encode(chunk).decode("ascii"),
        }

    def _handle_attachment_remove(self, p: dict) -> dict:
        with self._uow() as uow:
            owner_type, owner_id = self._resolve_attachment_owner(p)
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            svc.remove(owner_id, p["attachment_id"])
            return {"ok": True}

    def _handle_attachment_rename(self, p: dict) -> dict:
        with self._uow() as uow:
            owner_type, owner_id = self._resolve_attachment_owner(p)
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            attachment = svc.rename(owner_id, p["attachment_id"], p["filename"])
            dict_fn = attachment_to_dict if owner_type == "todo" else schedule_attachment_to_dict
            return {"ok": True, "attachment": dict_fn(attachment, self.user_id)}

    def _handle_attachment_remove_orphaned(self, p: dict) -> dict:
        with self._uow() as uow:
            owner_type, owner_id = self._resolve_attachment_owner(p)
            changelog = uow.todo_changelog_service if owner_type == "todo" else uow.schedule_changelog_service
            svc = self._make_attachment_service(uow, owner_type, changelog_service=changelog)
            count = svc.remove_orphaned(owner_id)
            return {"ok": True, "count": count}

    # ------------------------------------------------------------------
    # Changelog handlers
    # ------------------------------------------------------------------

    def _handle_todo_changelog(self, p: dict) -> dict:
        with self._uow() as uow:
            entries, total = uow.todo_changelog_service.query(
                entity_id=p.get("entity_id"),
                action=p.get("action"),
                start_at=p.get("start_at"),
                end_at=p.get("end_at"),
                limit=p.get("limit", 50),
                after_id=p.get("after_id"),
            )
            return {"ok": True, "total": total, "entries": [changelog_entry_to_dict(e) for e in entries]}

    def _handle_schedule_changelog(self, p: dict) -> dict:
        with self._uow() as uow:
            entries, total = uow.schedule_changelog_service.query(
                entity_id=p.get("entity_id"),
                action=p.get("action"),
                start_at=p.get("start_at"),
                end_at=p.get("end_at"),
                limit=p.get("limit", 50),
                after_id=p.get("after_id"),
            )
            return {"ok": True, "total": total, "entries": [changelog_entry_to_dict(e) for e in entries]}

    def _handle_notification_changelog(self, p: dict) -> dict:
        with self._uow() as uow:
            entries, total = uow.notification_changelog_service.query(
                entity_id=p.get("entity_id"),
                action=p.get("action"),
                start_at=p.get("start_at"),
                end_at=p.get("end_at"),
                limit=p.get("limit", 50),
                after_id=p.get("after_id"),
            )
            return {"ok": True, "total": total, "entries": [changelog_entry_to_dict(e) for e in entries]}

    # ------------------------------------------------------------------
    # User handler
    # ------------------------------------------------------------------

    def _handle_user(self, p: dict) -> dict:
        from models.user import User
        with self.db.session() as session:
            user = session.get(User, self.user_id)
        return {"ok": True, "user": user_to_dict(user)}


def _unique_targets(targets: list[int]) -> list[int]:
    return list(dict.fromkeys(targets))


def _bulk_attachment_counts(uow: UnitOfWork, owner_type: str, owner_ids: list[int]) -> dict[int, int]:
    """Single query to get attachment counts for a batch of owners."""
    if not owner_ids:
        return {}
    from sqlalchemy import func
    if owner_type == "todo":
        model = uow.attachment_model
        id_col = model.todo_id
    else:
        model = uow.schedule_attachment_model
        id_col = model.schedule_id
    return dict(
        uow.session.query(id_col, func.count())
        .filter(id_col.in_(owner_ids))
        .group_by(id_col)
        .all()
    )


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
