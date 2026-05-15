"""Schedule repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class ScheduleRepository:
    """Data access for schedule rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, schedule: object) -> object:
        """Persist a schedule row."""

        self._session.add(schedule)
        return schedule

    def remove(self, schedule: object) -> None:
        """Delete a schedule row."""

        self._session.delete(schedule)

    def get(self, schedule_id: int) -> object | None:
        """Return a schedule by id if it exists."""

        return self._session.get(self._model, schedule_id)

    def list_between(self, start_at: int, end_at: int) -> list[object]:
        """Return schedules that overlap a query window."""

        statement = (
            select(self._model)
            .where(self._model.start_at < end_at, self._model.end_at > start_at)
            .order_by(self._model.start_at, self._model.id)
        )
        return list(self._session.scalars(statement))

    def list_range(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        category: str | None = None,
        location: str | None = None,
    ) -> list[object]:
        """Return schedules with optional overlap, audit, and scalar filters."""

        statement = select(self._model)
        if start_at is not None:
            statement = statement.where(self._model.end_at > start_at)
        if end_at is not None:
            statement = statement.where(self._model.start_at < end_at)
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
        if category is not None:
            statement = statement.where(self._model.category == category)
        if location is not None:
            statement = statement.where(self._model.location == location)

        statement = statement.order_by(self._model.start_at, self._model.id)
        return list(self._session.scalars(statement))

    def find_conflict(
        self,
        start_at: int,
        end_at: int,
        exclude_id: int | None = None,
    ) -> object | None:
        """Return the first schedule that overlaps the given window."""

        statement = select(self._model).where(
            self._model.start_at < end_at, self._model.end_at > start_at
        )
        if exclude_id is not None:
            statement = statement.where(self._model.id != exclude_id)
        return self._session.scalars(
            statement.order_by(self._model.start_at).limit(1)
        ).first()
