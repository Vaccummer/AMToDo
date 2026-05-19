"""Notification repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class NotificationRepository:
    """Data access for Notification rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, notification: object) -> object:
        self._session.add(notification)
        return notification

    def remove(self, notification: object) -> None:
        self._session.delete(notification)

    def flush(self) -> None:
        self._session.flush()

    def get(self, notification_id: int) -> object | None:
        return self._session.scalars(
            select(self._model).where(
                self._model.id == notification_id,
                self._model.deleted_at.is_(None),
            )
        ).first()

    def get_including_deleted(self, notification_id: int) -> object | None:
        return self._session.get(self._model, notification_id)

    def list_between(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> list[object]:
        statement = select(self._model).where(self._model.deleted_at.is_(None))
        if start_at is not None:
            statement = statement.where(self._model.trigger_at >= start_at)
        if end_at is not None:
            statement = statement.where(self._model.trigger_at < end_at)
        statement = statement.order_by(self._model.trigger_at, self._model.id)
        return list(self._session.scalars(statement))

    def list_triggered(
        self,
        after: int,
        now: int,
    ) -> list[object]:
        """Return non-deleted notifications where trigger_at is in [after, now]."""
        statement = (
            select(self._model)
            .where(
                self._model.deleted_at.is_(None),
                self._model.trigger_at >= after,
                self._model.trigger_at <= now,
            )
            .order_by(self._model.trigger_at, self._model.id)
        )
        return list(self._session.scalars(statement))

    def list_deleted(self) -> list[object]:
        statement = (
            select(self._model)
            .where(self._model.deleted_at.isnot(None))
            .order_by(self._model.trigger_at.desc(), self._model.id.desc())
        )
        return list(self._session.scalars(statement))


class NotificationMentionRepository:
    """Data access for NotificationMention rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, mention: object) -> object:
        self._session.add(mention)
        return mention

    def list_for_notification(self, notification_id: int) -> list[object]:
        statement = (
            select(self._model)
            .where(self._model.notification_id == notification_id)
            .order_by(self._model.id)
        )
        return list(self._session.scalars(statement))

    def list_for_notifications(self, notification_ids: list[int]) -> dict[int, list[object]]:
        """Return mentions grouped by notification_id for a batch of IDs."""
        if not notification_ids:
            return {}
        statement = (
            select(self._model)
            .where(self._model.notification_id.in_(notification_ids))
            .order_by(self._model.notification_id, self._model.id)
        )
        result: dict[int, list[object]] = {nid: [] for nid in notification_ids}
        for mention in self._session.scalars(statement):
            result[mention.notification_id].append(mention)
        return result

    def delete_for_notification(self, notification_id: int) -> None:
        mentions = self.list_for_notification(notification_id)
        for mention in mentions:
            self._session.delete(mention)
