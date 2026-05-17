"""Changelog repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class TodoChangelogRepository:
    """Data access for todo changelog rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, entry: object) -> object:
        """Persist a changelog entry."""
        self._session.add(entry)
        return entry

    def list_for_entity(
        self,
        entity_id: int,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return changelog entries for a specific entity, with total count."""
        statement = select(self._model).where(self._model.entity_id == entity_id)
        count_statement = select(func.count()).select_from(self._model).where(
            self._model.entity_id == entity_id
        )
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total

    def list_all(
        self,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return all changelog entries with optional filters and total count."""
        statement = select(self._model)
        count_statement = select(func.count()).select_from(self._model)
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total


class ScheduleChangelogRepository:
    """Data access for schedule changelog rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, entry: object) -> object:
        """Persist a changelog entry."""
        self._session.add(entry)
        return entry

    def list_for_entity(
        self,
        entity_id: int,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return changelog entries for a specific entity, with total count."""
        statement = select(self._model).where(self._model.entity_id == entity_id)
        count_statement = select(func.count()).select_from(self._model).where(
            self._model.entity_id == entity_id
        )
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total

    def list_all(
        self,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return all changelog entries with optional filters and total count."""
        statement = select(self._model)
        count_statement = select(func.count()).select_from(self._model)
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total


class NotificationChangelogRepository:
    """Data access for notification changelog rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, entry: object) -> object:
        """Persist a changelog entry."""
        self._session.add(entry)
        return entry

    def list_for_entity(
        self,
        entity_id: int,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return changelog entries for a specific entity, with total count."""
        statement = select(self._model).where(self._model.entity_id == entity_id)
        count_statement = select(func.count()).select_from(self._model).where(
            self._model.entity_id == entity_id
        )
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total

    def list_all(
        self,
        *,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[object], int]:
        """Return all changelog entries with optional filters and total count."""
        statement = select(self._model)
        count_statement = select(func.count()).select_from(self._model)
        if action is not None:
            statement = statement.where(self._model.action == action)
            count_statement = count_statement.where(self._model.action == action)
        if start_at is not None:
            statement = statement.where(self._model.created_at >= start_at)
            count_statement = count_statement.where(self._model.created_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.created_at < end_at)
            count_statement = count_statement.where(self._model.created_at < end_at)
        total = self._session.scalar(count_statement) or 0
        statement = statement.order_by(self._model.created_at.desc()).offset(offset).limit(limit)
        return list(self._session.scalars(statement)), total
