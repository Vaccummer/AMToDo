"""Changelog service boundaries."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from clock import Clock
    from repositories import (
        NotificationChangelogRepository,
        ScheduleChangelogRepository,
        TodoChangelogRepository,
    )


class TodoChangelogService:
    """Coordinates todo changelog use cases."""

    def __init__(self, repository: TodoChangelogRepository, clock: Clock, model_class: type) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class

    def record_create(self, entity_id: int, after_snapshot: dict) -> object:
        """Record a todo creation."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="create",
            changed_fields=json.dumps([]),
            before_snapshot=None,
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_update(
        self,
        entity_id: int,
        before_snapshot: dict,
        after_snapshot: dict,
        changed_fields: list[str],
    ) -> object:
        """Record a todo update."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="update",
            changed_fields=json.dumps(changed_fields),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_delete(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a todo soft-delete."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="delete",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_restore(self, entity_id: int, before_snapshot: dict, after_snapshot: dict) -> object:
        """Record a todo restore."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="restore",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_purge(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a todo permanent deletion."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="purge",
            changed_fields=json.dumps([]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_add(self, entity_id: int, attachment_meta: dict) -> object:
        """Record an attachment being added."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_add",
            changed_fields=json.dumps(["attachment"]),
            before_snapshot=None,
            after_snapshot=json.dumps(attachment_meta),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_remove(self, entity_id: int, attachment_meta: dict) -> object:
        """Record an attachment being removed."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_remove",
            changed_fields=json.dumps(["attachment"]),
            before_snapshot=json.dumps(attachment_meta),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_rename(
        self, entity_id: int, old_meta: dict, new_meta: dict,
    ) -> object:
        """Record an attachment being renamed."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_rename",
            changed_fields=json.dumps(["filename"]),
            before_snapshot=json.dumps(old_meta),
            after_snapshot=json.dumps(new_meta),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def query(
        self,
        *,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        after_id: int | None = None,
    ) -> tuple[list[object], int]:
        """Query changelog entries with optional filters."""
        if entity_id is not None:
            return self._repository.list_for_entity(
                entity_id,
                action=action,
                start_at=start_at,
                end_at=end_at,
                limit=limit,
                after_id=after_id,
            )
        return self._repository.list_all(
            action=action,
            start_at=start_at,
            end_at=end_at,
            limit=limit,
            after_id=after_id,
        )


class ScheduleChangelogService:
    """Coordinates schedule changelog use cases."""

    def __init__(self, repository: ScheduleChangelogRepository, clock: Clock, model_class: type) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class

    def record_create(self, entity_id: int, after_snapshot: dict) -> object:
        """Record a schedule creation."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="create",
            changed_fields=json.dumps([]),
            before_snapshot=None,
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_update(
        self,
        entity_id: int,
        before_snapshot: dict,
        after_snapshot: dict,
        changed_fields: list[str],
    ) -> object:
        """Record a schedule update."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="update",
            changed_fields=json.dumps(changed_fields),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_delete(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a schedule soft-delete."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="delete",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_restore(self, entity_id: int, before_snapshot: dict, after_snapshot: dict) -> object:
        """Record a schedule restore."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="restore",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_purge(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a schedule permanent deletion."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="purge",
            changed_fields=json.dumps([]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_add(self, entity_id: int, attachment_meta: dict) -> object:
        """Record an attachment being added."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_add",
            changed_fields=json.dumps(["attachment"]),
            before_snapshot=None,
            after_snapshot=json.dumps(attachment_meta),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_remove(self, entity_id: int, attachment_meta: dict) -> object:
        """Record an attachment being removed."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_remove",
            changed_fields=json.dumps(["attachment"]),
            before_snapshot=json.dumps(attachment_meta),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_attachment_rename(
        self, entity_id: int, old_meta: dict, new_meta: dict,
    ) -> object:
        """Record an attachment being renamed."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="attachment_rename",
            changed_fields=json.dumps(["filename"]),
            before_snapshot=json.dumps(old_meta),
            after_snapshot=json.dumps(new_meta),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def query(
        self,
        *,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        after_id: int | None = None,
    ) -> tuple[list[object], int]:
        """Query changelog entries with optional filters."""
        if entity_id is not None:
            return self._repository.list_for_entity(
                entity_id,
                action=action,
                start_at=start_at,
                end_at=end_at,
                limit=limit,
                after_id=after_id,
            )
        return self._repository.list_all(
            action=action,
            start_at=start_at,
            end_at=end_at,
            limit=limit,
            after_id=after_id,
        )


class NotificationChangelogService:
    """Coordinates notification changelog use cases."""

    def __init__(self, repository: NotificationChangelogRepository, clock: Clock, model_class: type) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class

    def record_create(self, entity_id: int, after_snapshot: dict) -> object:
        """Record a notification creation."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="create",
            changed_fields=json.dumps([]),
            before_snapshot=None,
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_update(
        self,
        entity_id: int,
        before_snapshot: dict,
        after_snapshot: dict,
        changed_fields: list[str],
    ) -> object:
        """Record a notification update."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="update",
            changed_fields=json.dumps(changed_fields),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_delete(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a notification soft-delete."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="delete",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_restore(self, entity_id: int, before_snapshot: dict, after_snapshot: dict) -> object:
        """Record a notification restore."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="restore",
            changed_fields=json.dumps(["deleted_at"]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=json.dumps(after_snapshot),
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def record_purge(self, entity_id: int, before_snapshot: dict) -> object:
        """Record a notification permanent deletion."""
        now = self._clock.now_epoch()
        entry = self._model(
            entity_id=entity_id,
            action="purge",
            changed_fields=json.dumps([]),
            before_snapshot=json.dumps(before_snapshot),
            after_snapshot=None,
            created_at=now,
            updated_at=None,
        )
        return self._repository.add(entry)

    def query(
        self,
        *,
        entity_id: int | None = None,
        action: str | None = None,
        start_at: int | None = None,
        end_at: int | None = None,
        limit: int = 50,
        after_id: int | None = None,
    ) -> tuple[list[object], int]:
        """Query changelog entries with optional filters."""
        if entity_id is not None:
            return self._repository.list_for_entity(
                entity_id,
                action=action,
                start_at=start_at,
                end_at=end_at,
                limit=limit,
                after_id=after_id,
            )
        return self._repository.list_all(
            action=action,
            start_at=start_at,
            end_at=end_at,
            limit=limit,
            after_id=after_id,
        )
