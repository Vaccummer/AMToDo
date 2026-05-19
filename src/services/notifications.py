# src/services/notifications.py
"""Notification service boundaries."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from exceptions import NotFoundError, ValidationError

if TYPE_CHECKING:
    from clock import Clock
    from repositories import NotificationMentionRepository, NotificationRepository


@dataclass(frozen=True, slots=True)
class NotificationDraft:
    """Input data for creating a notification."""

    title: str
    trigger_at: int
    description: str | None = None
    mentions: list[dict[str, int | str]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class NotificationUpdate:
    """Input data for updating a notification."""

    title: str | None = None
    description: str | None = None
    trigger_at: int | None = None
    mentions: list[dict[str, int | str]] | None = None
    _fields_set: frozenset[str] = frozenset()


class NotificationService:
    """Coordinates notification use cases."""

    def __init__(
        self,
        repository: NotificationRepository,
        mention_repository: NotificationMentionRepository,
        clock: Clock,
        model_class: type,
        mention_model_class: type,
        changelog_service=None,
    ) -> None:
        self._repository = repository
        self._mention_repo = mention_repository
        self._clock = clock
        self._model = model_class
        self._mention_model = mention_model_class
        self._changelog = changelog_service

    def create(self, draft: NotificationDraft) -> object:
        title = draft.title.strip()
        if not title:
            raise ValidationError("notification title cannot be empty")
        if draft.trigger_at < 0:
            raise ValidationError("trigger_at cannot be negative")

        now = self._clock.now_epoch()
        notification = self._model(
            title=title,
            description=draft.description,
            trigger_at=draft.trigger_at,
            created_at=now,
            updated_at=None,
        )
        notification = self._repository.add(notification)
        self._repository.flush()

        for mention_data in draft.mentions:
            target_type = mention_data.get("target_type")
            target_id = mention_data.get("target_id")
            if target_type not in ("todo", "schedule"):
                raise ValidationError(f"invalid target_type: {target_type}")
            if not isinstance(target_id, int) or target_id <= 0:
                raise ValidationError(f"invalid target_id: {target_id}")
            mention = self._mention_model(
                notification_id=notification.id,
                target_type=target_type,
                target_id=target_id,
            )
            self._mention_repo.add(mention)

        if self._changelog:
            self._repository.flush()
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            self._changelog.record_create(notification.id, notification_to_dict(notification, mentions))
        return notification

    def show(self, notification_id: int) -> object:
        notification = self._repository.get(notification_id)
        if notification is None:
            raise NotFoundError(f"notification #{notification_id} was not found")
        return notification

    def update(self, notification_id: int, update: NotificationUpdate) -> object:
        notification = self.show(notification_id)
        before = None
        if self._changelog:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            before = notification_to_dict(notification, mentions)
        changed = False
        explicit = update._fields_set

        if explicit:
            if "title" in explicit:
                title = update.title.strip() if update.title else ""
                if not title:
                    raise ValidationError("notification title cannot be empty")
                notification.title = title
                changed = True
            if "description" in explicit:
                notification.description = update.description
                changed = True
            if "trigger_at" in explicit:
                if update.trigger_at is not None and update.trigger_at < 0:
                    raise ValidationError("trigger_at cannot be negative")
                notification.trigger_at = update.trigger_at
                changed = True
            if "mentions" in explicit and update.mentions is not None:
                self._replace_mentions(notification.id, update.mentions)
                changed = True
        else:
            if update.title is not None:
                title = update.title.strip()
                if not title:
                    raise ValidationError("notification title cannot be empty")
                notification.title = title
                changed = True
            if update.description is not None:
                notification.description = update.description
                changed = True
            if update.trigger_at is not None:
                if update.trigger_at < 0:
                    raise ValidationError("trigger_at cannot be negative")
                notification.trigger_at = update.trigger_at
                changed = True
            if update.mentions is not None:
                self._replace_mentions(notification.id, update.mentions)
                changed = True

        if changed:
            notification.updated_at = self._clock.now_epoch()
        if changed and self._changelog and before is not None:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            after = notification_to_dict(notification, mentions)
            self._changelog.record_update(notification.id, before, after, list(update._fields_set))
        return notification

    def remove(self, notification_id: int) -> object:
        notification = self.show(notification_id)
        before = None
        if self._changelog:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            before = notification_to_dict(notification, mentions)
        now = self._clock.now_epoch()
        notification.deleted_at = now
        notification.updated_at = now
        if self._changelog and before is not None:
            self._changelog.record_delete(notification_id, before)
        return notification

    def restore(self, notification_id: int) -> object:
        notification = self._repository.get_including_deleted(notification_id)
        if notification is None:
            raise NotFoundError(f"notification #{notification_id} was not found")
        if notification.deleted_at is None:
            raise ValidationError(f"notification #{notification_id} is not deleted")
        before = None
        if self._changelog:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            before = notification_to_dict(notification, mentions)
        now = self._clock.now_epoch()
        notification.deleted_at = None
        notification.updated_at = now
        if self._changelog and before is not None:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            after = notification_to_dict(notification, mentions)
            self._changelog.record_restore(notification_id, before, after)
        return notification

    def purge(self, notification_id: int) -> object:
        notification = self._repository.get_including_deleted(notification_id)
        if notification is None:
            raise NotFoundError(f"notification #{notification_id} was not found")
        if notification.deleted_at is None:
            raise ValidationError(f"notification #{notification_id} is not deleted; use remove first")
        before = None
        if self._changelog:
            from serialization import notification_to_dict
            mentions = self._mention_repo.list_for_notification(notification.id)
            before = notification_to_dict(notification, mentions)
        self._mention_repo.delete_for_notification(notification_id)
        self._repository.remove(notification)
        self._repository.flush()
        if self._changelog and before is not None:
            self._changelog.record_purge(notification_id, before)
        return notification

    def list_between(
        self,
        start_at: int | None = None,
        end_at: int | None = None,
    ) -> list[object]:
        return self._repository.list_between(start_at, end_at)

    def list_triggered(self, after: int, now: int) -> list[object]:
        if after < 0:
            raise ValidationError("after cannot be negative")
        if now < after:
            raise ValidationError("now must be >= after")
        return self._repository.list_triggered(after, now)

    def list_deleted(self) -> list[object]:
        return self._repository.list_deleted()

    def get_mentions(self, notification_id: int) -> list[object]:
        return self._mention_repo.list_for_notification(notification_id)

    def get_mentions_batch(self, notification_ids: list[int]) -> dict[int, list[object]]:
        """Return mentions grouped by notification_id for a batch of IDs."""
        return self._mention_repo.list_for_notifications(notification_ids)

    def _replace_mentions(
        self, notification_id: int, mentions: list[dict[str, int | str]]
    ) -> None:
        self._mention_repo.delete_for_notification(notification_id)
        for mention_data in mentions:
            target_type = mention_data.get("target_type")
            target_id = mention_data.get("target_id")
            if target_type not in ("todo", "schedule"):
                raise ValidationError(f"invalid target_type: {target_type}")
            if not isinstance(target_id, int) or target_id <= 0:
                raise ValidationError(f"invalid target_id: {target_id}")
            mention = self._mention_model(
                notification_id=notification_id,
                target_type=target_type,
                target_id=target_id,
            )
            self._mention_repo.add(mention)
