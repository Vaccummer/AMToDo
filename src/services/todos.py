"""ToDo service boundaries."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING

from exceptions import NotFoundError, ValidationError
from models import Todo

if TYPE_CHECKING:
    from repositories import TodoRepository
    from clock import Clock


@dataclass(frozen=True, slots=True)
class TodoDraft:
    """Input data for creating a ToDo item."""

    title: str
    due_at: int | None = None
    description: str | None = None
    priority: int = 0
    tag: str | None = None


@dataclass(frozen=True, slots=True)
class TodoUpdate:
    """Input data for updating a ToDo item."""

    title: str | None = None
    due_at: int | None = None
    description: str | None = None
    priority: int | None = None
    tag: str | None = None


class TodoService:
    """Coordinates ToDo use cases without depending on UI or CLI."""

    def __init__(self, repository: TodoRepository, clock: Clock, model_class: type) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class

    def create(self, draft: TodoDraft) -> Todo:
        """Create a ToDo item."""

        title = draft.title.strip()
        if not title:
            raise ValidationError("todo title cannot be empty")
        if draft.priority < 0:
            raise ValidationError("todo priority cannot be negative")
        if draft.due_at is not None and draft.due_at < 0:
            raise ValidationError("todo due_at cannot be negative")

        now = self._clock.now_epoch()
        todo = self._model(
            title=title,
            description=draft.description,
            due_at=draft.due_at,
            completed=False,
            priority=draft.priority,
            tag=draft.tag,
            completed_at=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(todo)

    def list_all(self, completed: bool | None = None) -> list[Todo]:
        """Return all ToDos, optionally filtered by completion."""
        return self._repository.list_due_range(completed=completed)

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
        """Return ToDos due in a date range."""

        if start_at >= end_at:
            raise ValidationError("start_at must be earlier than end_at")
        return self._repository.list_due_between(start_at, end_at, completed=completed)

    def search(
        self,
        pattern: str,
        start_at: int | None = None,
        end_at: int | None = None,
        completed: bool | None = None,
        *,
        case_sensitive: bool = True,
    ) -> list[Todo]:
        """Search ToDos using a regular expression and optional epoch bounds."""

        if start_at is not None and start_at < 0:
            raise ValidationError("start_at cannot be negative")
        if end_at is not None and end_at < 0:
            raise ValidationError("end_at cannot be negative")
        if start_at is not None and end_at is not None and start_at >= end_at:
            raise ValidationError("start_at must be earlier than end_at")

        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags=flags)
        except re.error as exc:
            msg = f"invalid regex pattern: {exc}"
            raise ValidationError(msg) from exc

        todos = self._repository.list_due_range(
            start_at=start_at,
            end_at=end_at,
            completed=completed,
        )
        return [todo for todo in todos if regex.search(_search_text(todo))]

    def update(self, todo_id: int, update: TodoUpdate) -> Todo:
        """Update mutable ToDo fields."""

        todo = self.show(todo_id)
        changed = False

        if update.title is not None:
            title = update.title.strip()
            if not title:
                raise ValidationError("todo title cannot be empty")
            todo.title = title
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
        """Remove a ToDo by id."""

        todo = self.show(todo_id)
        self._repository.remove(todo)
        return todo

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


def _search_text(todo: Todo) -> str:
    return "\n".join(
        value
        for value in (
            todo.title,
            todo.description or "",
            todo.tag or "",
        )
        if value
    )
