"""ToDo repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class TodoRepository:
    """Data access for ToDo rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, todo: object) -> object:
        """Persist a ToDo row."""
        self._session.add(todo)
        return todo

    def remove(self, todo: object) -> None:
        """Delete a ToDo row."""
        self._session.delete(todo)

    def get(self, todo_id: int) -> object | None:
        """Return a non-deleted ToDo by id."""
        return self._session.scalars(
            select(self._model).where(
                self._model.id == todo_id,
                self._model.deleted_at.is_(None),
            )
        ).first()

    def get_including_deleted(self, todo_id: int) -> object | None:
        """Return a ToDo by id regardless of deletion state."""
        return self._session.get(self._model, todo_id)

    def list_all(self) -> list[object]:
        """Return all non-deleted ToDos ordered for stable display."""
        statement = (
            select(self._model)
            .where(self._model.deleted_at.is_(None))
            .order_by(
                self._model.planned_at,
                self._model.completed,
                self._model.priority.desc(),
                self._model.id,
            )
        )
        return list(self._session.scalars(statement))

    def list_planned_between(
        self,
        start_at: int,
        end_at: int,
        completed: bool | None = None,
    ) -> list[object]:
        """Return non-deleted ToDos planned in the requested range."""
        statement = select(self._model).where(
            self._model.planned_at >= start_at,
            self._model.planned_at < end_at,
            self._model.deleted_at.is_(None),
        )
        if completed is not None:
            statement = statement.where(self._model.completed.is_(completed))
        statement = statement.order_by(
            self._model.planned_at,
            self._model.completed,
            self._model.priority.desc(),
            self._model.id,
        )
        return list(self._session.scalars(statement))

    def list_created_between(
        self,
        start_at: int,
        end_at: int,
        completed: bool | None = None,
    ) -> list[object]:
        """Return non-deleted ToDos created in the requested range."""
        return self.list_filtered(
            created_start_at=start_at,
            created_end_at=end_at,
            completed=completed,
        )

    def list_filtered(
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
        include_deleted: bool = False,
        deleted_only: bool = False,
    ) -> list[object]:
        """Return ToDos matching optional timestamp and scalar filters."""
        statement = select(self._model)
        if deleted_only:
            statement = statement.where(self._model.deleted_at.isnot(None))
        elif not include_deleted:
            statement = statement.where(self._model.deleted_at.is_(None))
        if planned_start_at is not None:
            statement = statement.where(self._model.planned_at >= planned_start_at)
        if planned_end_at is not None:
            statement = statement.where(self._model.planned_at < planned_end_at)
        if due_start_at is not None:
            statement = statement.where(self._model.due_at >= due_start_at)
        if due_end_at is not None:
            statement = statement.where(self._model.due_at < due_end_at)
        if created_start_at is not None:
            statement = statement.where(self._model.created_at >= created_start_at)
        if created_end_at is not None:
            statement = statement.where(self._model.created_at < created_end_at)
        if updated_start_at is not None or updated_end_at is not None:
            updated_expr = func.coalesce(self._model.updated_at, self._model.created_at)
            if updated_start_at is not None:
                statement = statement.where(updated_expr >= updated_start_at)
            if updated_end_at is not None:
                statement = statement.where(updated_expr < updated_end_at)
        if completed is not None:
            statement = statement.where(self._model.completed.is_(completed))
        if priority_min is not None:
            statement = statement.where(self._model.priority >= priority_min)
        if priority_max is not None:
            statement = statement.where(self._model.priority <= priority_max)
        if tag is not None:
            statement = statement.where(self._model.tag == tag)
        statement = statement.order_by(
            self._model.planned_at,
            self._model.created_at,
            self._model.completed,
            self._model.priority.desc(),
            self._model.id,
        )
        return list(self._session.scalars(statement))

    def list_due_range(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
        completed: bool | None = None,
    ) -> list[object]:
        """Return non-deleted ToDos with optional due timestamp bounds."""
        statement = select(self._model).where(self._model.deleted_at.is_(None))
        if start_at is not None:
            statement = statement.where(self._model.due_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.due_at < end_at)
        if completed is not None:
            statement = statement.where(self._model.completed.is_(completed))
        statement = statement.order_by(
            self._model.due_at,
            self._model.completed,
            self._model.priority.desc(),
            self._model.id,
        )
        return list(self._session.scalars(statement))

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
    ) -> list[object]:
        """Return deleted ToDos matching optional filters."""
        return self.list_filtered(
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
            deleted_only=True,
        )
