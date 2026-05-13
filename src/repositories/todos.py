"""ToDo repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

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
        """Return a ToDo by id if it exists."""

        return self._session.get(self._model, todo_id)

    def list_all(self) -> list[object]:
        """Return all ToDos ordered for stable display."""

        statement = select(self._model).order_by(
            self._model.due_at,
            self._model.completed,
            self._model.priority.desc(),
            self._model.id,
        )
        return list(self._session.scalars(statement))

    def list_due_between(
        self,
        start_at: int,
        end_at: int,
        completed: bool | None = None,
    ) -> list[object]:
        """Return ToDos with due boundaries in the requested range."""

        statement = select(self._model).where(
            self._model.created_at >= start_at, self._model.created_at < end_at
        )
        if completed is not None:
            statement = statement.where(self._model.completed.is_(completed))

        statement = statement.order_by(
            self._model.created_at, self._model.completed, self._model.priority.desc(), self._model.id
        )
        return list(self._session.scalars(statement))

    def list_due_range(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
        completed: bool | None = None,
    ) -> list[object]:
        """Return ToDos with optional due timestamp bounds."""

        statement = select(self._model)
        if start_at is not None:
            statement = statement.where(self._model.due_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.due_at < end_at)
        if completed is not None:
            statement = statement.where(self._model.completed.is_(completed))

        statement = statement.order_by(
            self._model.due_at, self._model.completed, self._model.priority.desc(), self._model.id
        )
        return list(self._session.scalars(statement))
