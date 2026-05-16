"""ToDo service boundaries."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING

from exceptions import NotFoundError, ValidationError
from models import Todo
from services.search_common import (
    compile_search_query,
    search_text,
    sort_results,
    validate_fields,
    validate_optional_range,
    validate_sort,
)

if TYPE_CHECKING:
    from clock import Clock
    from repositories import TodoRepository

TODO_SEARCH_FIELDS = frozenset({"title", "description", "tag"})
TODO_SORT_FIELDS = frozenset(
    {
        "created_at",
        "updated_at",
        "planned_at",
        "due_at",
        "priority",
        "title",
        "completed_at",
    }
)


@dataclass(frozen=True, slots=True)
class TodoDraft:
    """Input data for creating a ToDo item."""

    title: str
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int = 0
    tag: str | None = None


@dataclass(frozen=True, slots=True)
class TodoUpdate:
    """Input data for updating a ToDo item.

    Each optional field defaults to None.  Use ``_fields_set`` (a frozenset of
    field names) to distinguish between *not passed* and *explicitly passed as
    None* so callers can clear nullable columns.
    """

    title: str | None = None
    planned_at: int | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int | None = None
    tag: str | None = None
    _fields_set: frozenset[str] = frozenset()


class TodoService:
    """Coordinates ToDo use cases without depending on UI or CLI."""

    def __init__(self, repository: TodoRepository, clock: Clock, model_class: type, changelog_service=None) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class
        self._changelog = changelog_service

    def create(self, draft: TodoDraft) -> Todo:
        """Create a ToDo item."""

        title = draft.title.strip()
        if not title:
            raise ValidationError("todo title cannot be empty")
        if draft.priority < 0:
            raise ValidationError("todo priority cannot be negative")
        if draft.planned_at is not None and draft.planned_at < 0:
            raise ValidationError("todo planned_at cannot be negative")
        if draft.due_at is not None and draft.due_at < 0:
            raise ValidationError("todo due_at cannot be negative")

        now = self._clock.now_epoch()
        todo = self._model(
            title=title,
            description=draft.description,
            planned_at=draft.planned_at if draft.planned_at is not None else now,
            due_at=draft.due_at,
            completed=False,
            priority=draft.priority,
            tag=draft.tag,
            completed_at=None,
            created_at=now,
            updated_at=None,
        )
        todo = self._repository.add(todo)
        if self._changelog:
            self._repository.flush()
            from serialization import todo_to_dict
            self._changelog.record_create(todo.id, todo_to_dict(todo, "UTC"))
        return todo

    def list_all(self, completed: bool | None = None) -> list[Todo]:
        """Return all ToDos, optionally filtered by completion."""
        return self._repository.list_filtered(completed=completed)

    def show(self, todo_id: int) -> Todo:
        """Return a ToDo by id."""

        todo = self._repository.get(todo_id)
        if todo is None:
            raise NotFoundError(f"todo #{todo_id} was not found")
        return todo

    def list_between(
        self,
        start_at: int,
        end_at: int,
        completed: bool | None = None,
    ) -> list[Todo]:
        """Return ToDos planned in a date range."""

        if start_at >= end_at:
            raise ValidationError("start_at must be earlier than end_at")
        return self._repository.list_planned_between(start_at, end_at, completed=completed)

    def search(
        self,
        query: str,
        fields: list[str] | None = None,
        *,
        use_regex: bool = False,
        ignore_case: bool = True,
        planned_start_at: int | None = None,
        planned_end_at: int | None = None,
        due_start_at: int | None = None,
        due_end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        completed: bool | None = None,
        priority_min: int | None = None,
        priority_max: int | None = None,
        tag: str | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> list[Todo]:
        """Search ToDos with field selection, filters, and deterministic sorting."""

        resolved_fields = validate_fields(fields, TODO_SEARCH_FIELDS, "todo search fields")
        validate_sort(sort_by, sort_order, TODO_SORT_FIELDS)
        validate_optional_range(
            planned_start_at,
            planned_end_at,
            start_name="planned_start_at",
            end_name="planned_end_at",
        )
        validate_optional_range(
            due_start_at,
            due_end_at,
            start_name="due_start_at",
            end_name="due_end_at",
        )
        validate_optional_range(
            created_start_at,
            created_end_at,
            start_name="created_start_at",
            end_name="created_end_at",
        )
        validate_optional_range(
            updated_start_at,
            updated_end_at,
            start_name="updated_start_at",
            end_name="updated_end_at",
        )
        if priority_min is not None and priority_min < 0:
            raise ValidationError("priority_min cannot be negative")
        if priority_max is not None and priority_max < 0:
            raise ValidationError("priority_max cannot be negative")
        if (
            priority_min is not None
            and priority_max is not None
            and priority_min > priority_max
        ):
            raise ValidationError("priority_min cannot be greater than priority_max")

        regex = compile_search_query(query, use_regex=use_regex, ignore_case=ignore_case)

        todos = self._repository.list_filtered(
            planned_start_at=planned_start_at,
            planned_end_at=planned_end_at,
            due_start_at=due_start_at,
            due_end_at=due_end_at,
            created_start_at=created_start_at,
            created_end_at=created_end_at,
            updated_start_at=updated_start_at,
            updated_end_at=updated_end_at,
            completed=completed,
            priority_min=priority_min,
            priority_max=priority_max,
            tag=tag,
        )
        matched = [
            todo
            for todo in todos
            if regex.search(search_text(todo, resolved_fields))
        ]
        return sort_results(
            matched, sort_by=sort_by, sort_order=sort_order, value_fn=_todo_sort_value
        )

    def update(self, todo_id: int, update: TodoUpdate) -> Todo:
        """Update mutable ToDo fields."""

        todo = self.show(todo_id)
        before = None
        if self._changelog:
            from serialization import todo_to_dict
            before = todo_to_dict(todo, "UTC")
        changed = False
        explicit = update._fields_set

        if explicit:
            if "title" in explicit:
                title = update.title.strip()
                if not title:
                    raise ValidationError("todo title cannot be empty")
                todo.title = title
                changed = True
            if "planned_at" in explicit:
                if update.planned_at is not None and update.planned_at < 0:
                    raise ValidationError("todo planned_at cannot be negative")
                todo.planned_at = update.planned_at
                changed = True
            if "due_at" in explicit:
                if update.due_at is not None and update.due_at < 0:
                    raise ValidationError("todo due_at cannot be negative")
                todo.due_at = update.due_at
                changed = True
            if "description" in explicit:
                todo.description = update.description
                changed = True
            if "priority" in explicit:
                if update.priority is not None and update.priority < 0:
                    raise ValidationError("todo priority cannot be negative")
                todo.priority = update.priority
                changed = True
            if "tag" in explicit:
                todo.tag = update.tag
                changed = True
        else:
            if update.title is not None:
                title = update.title.strip()
                if not title:
                    raise ValidationError("todo title cannot be empty")
                todo.title = title
                changed = True
            if update.planned_at is not None:
                if update.planned_at < 0:
                    raise ValidationError("todo planned_at cannot be negative")
                todo.planned_at = update.planned_at
                changed = True
            if update.due_at is not None:
                if update.due_at < 0:
                    raise ValidationError("todo due_at cannot be negative")
                todo.due_at = update.due_at
                changed = True
            if update.description is not None:
                todo.description = update.description
                changed = True
            if update.priority is not None:
                if update.priority < 0:
                    raise ValidationError("todo priority cannot be negative")
                todo.priority = update.priority
                changed = True
            if update.tag is not None:
                todo.tag = update.tag
                changed = True

        if changed:
            todo.updated_at = self._clock.now_epoch()
        if changed and self._changelog and before is not None:
            after = todo_to_dict(todo, "UTC")
            self._changelog.record_update(todo.id, before, after, list(update._fields_set))
        return todo

    def complete(self, todo_id: int) -> Todo:
        """Mark a ToDo as completed."""

        todo = self._repository.get(todo_id)
        if todo is None:
            raise NotFoundError(f"todo #{todo_id} was not found")
        if todo.completed:
            return todo

        now = self._clock.now_epoch()
        todo.completed = True
        todo.completed_at = now
        todo.updated_at = now
        return todo

    def reopen(self, todo_id: int) -> Todo:
        """Mark a ToDo as open."""

        todo = self.show(todo_id)
        if not todo.completed:
            return todo

        todo.completed = False
        todo.completed_at = None
        todo.updated_at = self._clock.now_epoch()
        return todo

    def remove(self, todo_id: int) -> Todo:
        """Soft-delete a ToDo by id (move to trash)."""

        todo = self.show(todo_id)
        before = None
        if self._changelog:
            from serialization import todo_to_dict
            before = todo_to_dict(todo, "UTC")
        now = self._clock.now_epoch()
        todo.deleted_at = now
        todo.updated_at = now
        if self._changelog and before is not None:
            self._changelog.record_delete(todo_id, before)
        return todo

    def restore(self, todo_id: int) -> Todo:
        """Restore a soft-deleted ToDo."""

        todo = self._repository.get_including_deleted(todo_id)
        if todo is None:
            raise NotFoundError(f"todo #{todo_id} was not found")
        if todo.deleted_at is None:
            raise ValidationError(f"todo #{todo_id} is not deleted")
        before = None
        if self._changelog:
            from serialization import todo_to_dict
            before = todo_to_dict(todo, "UTC")
        now = self._clock.now_epoch()
        todo.deleted_at = None
        todo.updated_at = now
        if self._changelog and before is not None:
            after = todo_to_dict(todo, "UTC")
            self._changelog.record_restore(todo_id, before, after)
        return todo

    def purge(self, todo_id: int) -> Todo:
        """Permanently delete a ToDo (must already be soft-deleted)."""

        todo = self._repository.get_including_deleted(todo_id)
        if todo is None:
            raise NotFoundError(f"todo #{todo_id} was not found")
        if todo.deleted_at is None:
            raise ValidationError(f"todo #{todo_id} is not deleted; use remove first")
        before = None
        if self._changelog:
            from serialization import todo_to_dict
            before = todo_to_dict(todo, "UTC")
        self._repository.remove(todo)
        self._repository.flush()
        if self._changelog and before is not None:
            self._changelog.record_purge(todo_id, before)
        return todo

    def list_deleted(
        self,
        *,
        planned_start_at: int | None = None,
        planned_end_at: int | None = None,
        due_start_at: int | None = None,
        due_end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        completed: bool | None = None,
        priority_min: int | None = None,
        priority_max: int | None = None,
        tag: str | None = None,
    ) -> list[Todo]:
        """Return deleted ToDos matching optional filters."""

        return self._repository.list_deleted(
            planned_start_at=planned_start_at,
            planned_end_at=planned_end_at,
            due_start_at=due_start_at,
            due_end_at=due_end_at,
            created_start_at=created_start_at,
            created_end_at=created_end_at,
            updated_start_at=updated_start_at,
            updated_end_at=updated_end_at,
            completed=completed,
            priority_min=priority_min,
            priority_max=priority_max,
            tag=tag,
        )

    def stats(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> dict[str, object]:
        """Return ToDo statistics for an optional due timestamp range."""

        if start_at is not None and start_at < 0:
            raise ValidationError("start_at cannot be negative")
        if end_at is not None and end_at < 0:
            raise ValidationError("end_at cannot be negative")
        if start_at is not None and end_at is not None and start_at >= end_at:
            raise ValidationError("start_at must be earlier than end_at")

        todos = self._repository.list_due_range(start_at=start_at, end_at=end_at)
        by_tag = Counter(todo.tag or "" for todo in todos)
        return {
            "total": len(todos),
            "open": sum(1 for todo in todos if not todo.completed),
            "completed": sum(1 for todo in todos if todo.completed),
            "by_tag": dict(sorted(by_tag.items())),
        }


def _todo_sort_value(todo: Todo, sort_by: str) -> object:
    """Extract sort value from a Todo entity."""
    if sort_by == "updated_at":
        return todo.updated_at if todo.updated_at is not None else todo.created_at
    return getattr(todo, sort_by)
