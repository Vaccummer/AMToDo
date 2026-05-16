"""Schedule service boundaries."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from exceptions import ConflictError, NotFoundError, ValidationError
from models import Schedule
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
    from repositories import ScheduleRepository

SCHEDULE_SEARCH_FIELDS = frozenset({"title", "description", "location", "category"})
SCHEDULE_SORT_FIELDS = frozenset(
    {
        "created_at",
        "updated_at",
        "start_at",
        "end_at",
        "duration",
        "title",
    }
)


@dataclass(frozen=True, slots=True)
class ScheduleDraft:
    """Input data for creating a schedule item."""

    title: str
    start_at: int
    end_at: int
    timezone: str
    description: str | None = None
    location: str | None = None
    category: str | None = None


@dataclass(frozen=True, slots=True)
class ScheduleUpdate:
    """Input data for updating a schedule item.

    Each optional field defaults to None.  Use ``_fields_set`` (a frozenset of
    field names) to distinguish between *not passed* and *explicitly passed as
    None* so callers can clear nullable columns.
    """

    title: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    description: str | None = None
    location: str | None = None
    category: str | None = None
    _fields_set: frozenset[str] = frozenset()


class ScheduleService:
    """Coordinates schedule use cases without depending on UI or CLI."""

    def __init__(self, repository: ScheduleRepository, clock: Clock, model_class: type, changelog_service=None) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class
        self._changelog = changelog_service

    def create(self, draft: ScheduleDraft) -> Schedule:
        """Create a schedule item after validating the time window."""

        title = draft.title.strip()
        if not title:
            raise ValidationError("schedule title cannot be empty")
        self._validate_window(draft.start_at, draft.end_at)

        conflict = self._repository.find_conflict(draft.start_at, draft.end_at)
        if conflict is not None:
            raise ConflictError(f"schedule conflicts with existing item #{conflict.id}")

        now = self._clock.now_epoch()
        schedule = self._model(
            title=title,
            description=draft.description,
            start_at=draft.start_at,
            end_at=draft.end_at,
            timezone=draft.timezone,
            location=draft.location,
            category=draft.category,
            created_at=now,
            updated_at=None,
        )
        schedule = self._repository.add(schedule)
        if self._changelog:
            self._repository.flush()
            from serialization import schedule_to_dict
            self._changelog.record_create(schedule.id, schedule_to_dict(schedule))
        return schedule

    def show(self, schedule_id: int) -> Schedule:
        """Return a schedule by id."""

        schedule = self._repository.get(schedule_id)
        if schedule is None:
            raise NotFoundError(f"schedule #{schedule_id} was not found")
        return schedule

    def list_between(self, start_at: int, end_at: int) -> list[Schedule]:
        """Return schedules overlapping an epoch range."""

        self._validate_window(start_at, end_at)
        return self._repository.list_between(start_at, end_at)

    def search(
        self,
        query: str,
        fields: list[str] | None = None,
        *,
        use_regex: bool = False,
        ignore_case: bool = True,
        start_at: int | None = None,
        end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        category: str | None = None,
        location: str | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> list[Schedule]:
        """Search schedules with field selection, filters, and deterministic sorting."""

        resolved_fields = validate_fields(
            fields,
            SCHEDULE_SEARCH_FIELDS,
            "schedule search fields",
        )
        validate_sort(sort_by, sort_order, SCHEDULE_SORT_FIELDS)
        validate_optional_range(
            start_at, end_at, start_name="start_at", end_name="end_at"
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
        regex = compile_search_query(query, use_regex=use_regex, ignore_case=ignore_case)

        schedules = self._repository.list_range(
            start_at=start_at,
            end_at=end_at,
            created_start_at=created_start_at,
            created_end_at=created_end_at,
            updated_start_at=updated_start_at,
            updated_end_at=updated_end_at,
            category=category,
            location=location,
        )
        matched = [
            schedule
            for schedule in schedules
            if regex.search(search_text(schedule, resolved_fields))
        ]
        return sort_results(
            matched, sort_by=sort_by, sort_order=sort_order, value_fn=_schedule_sort_value
        )

    def update(self, schedule_id: int, update: ScheduleUpdate) -> Schedule:
        """Update mutable schedule fields while preserving conflict checks."""

        schedule = self.show(schedule_id)
        before = None
        if self._changelog:
            from serialization import schedule_to_dict
            before = schedule_to_dict(schedule)
        next_start_at = schedule.start_at if update.start_at is None else update.start_at
        next_end_at = schedule.end_at if update.end_at is None else update.end_at
        self._validate_window(next_start_at, next_end_at)

        conflict = self._repository.find_conflict(
            next_start_at,
            next_end_at,
            exclude_id=schedule_id,
        )
        if conflict is not None:
            raise ConflictError(f"schedule conflicts with existing item #{conflict.id}")

        changed = False
        explicit = update._fields_set

        if explicit:
            if "title" in explicit:
                title = update.title.strip()
                if not title:
                    raise ValidationError("schedule title cannot be empty")
                schedule.title = title
                changed = True
            if "start_at" in explicit:
                schedule.start_at = update.start_at
                changed = True
            if "end_at" in explicit:
                schedule.end_at = update.end_at
                changed = True
            if "description" in explicit:
                schedule.description = update.description
                changed = True
            if "location" in explicit:
                schedule.location = update.location
                changed = True
            if "category" in explicit:
                schedule.category = update.category
                changed = True
        else:
            if update.title is not None:
                title = update.title.strip()
                if not title:
                    raise ValidationError("schedule title cannot be empty")
                schedule.title = title
                changed = True
            if update.start_at is not None:
                schedule.start_at = update.start_at
                changed = True
            if update.end_at is not None:
                schedule.end_at = update.end_at
                changed = True
            if update.description is not None:
                schedule.description = update.description
                changed = True
            if update.location is not None:
                schedule.location = update.location
                changed = True
            if update.category is not None:
                schedule.category = update.category
                changed = True

        if changed:
            schedule.updated_at = self._clock.now_epoch()
        if changed and self._changelog and before is not None:
            after = schedule_to_dict(schedule)
            self._changelog.record_update(schedule.id, before, after, list(update._fields_set))
        return schedule

    def remove(self, schedule_id: int) -> Schedule:
        """Soft-delete a schedule by id (move to trash)."""
        schedule = self.show(schedule_id)
        before = None
        if self._changelog:
            from serialization import schedule_to_dict
            before = schedule_to_dict(schedule)
        now = self._clock.now_epoch()
        schedule.deleted_at = now
        schedule.updated_at = now
        if self._changelog and before is not None:
            self._changelog.record_delete(schedule_id, before)
        return schedule

    def restore(self, schedule_id: int) -> Schedule:
        """Restore a soft-deleted schedule."""
        schedule = self._repository.get_including_deleted(schedule_id)
        if schedule is None:
            raise NotFoundError(f"schedule #{schedule_id} was not found")
        if schedule.deleted_at is None:
            raise ValidationError(f"schedule #{schedule_id} is not deleted")
        before = None
        if self._changelog:
            from serialization import schedule_to_dict
            before = schedule_to_dict(schedule)
        now = self._clock.now_epoch()
        schedule.deleted_at = None
        schedule.updated_at = now
        if self._changelog and before is not None:
            after = schedule_to_dict(schedule)
            self._changelog.record_restore(schedule_id, before, after)
        return schedule

    def purge(self, schedule_id: int) -> Schedule:
        """Permanently delete a schedule (must already be soft-deleted)."""
        schedule = self._repository.get_including_deleted(schedule_id)
        if schedule is None:
            raise NotFoundError(f"schedule #{schedule_id} was not found")
        if schedule.deleted_at is None:
            raise ValidationError(f"schedule #{schedule_id} is not deleted; use remove first")
        before = None
        if self._changelog:
            from serialization import schedule_to_dict
            before = schedule_to_dict(schedule)
        self._repository.remove(schedule)
        self._repository.flush()
        if self._changelog and before is not None:
            self._changelog.record_purge(schedule_id, before)
        return schedule

    def list_deleted(
        self,
        *,
        start_at: int | None = None,
        end_at: int | None = None,
        created_start_at: int | None = None,
        created_end_at: int | None = None,
        updated_start_at: int | None = None,
        updated_end_at: int | None = None,
        category: str | None = None,
        location: str | None = None,
    ) -> list[Schedule]:
        """Return deleted schedules matching optional filters."""
        return self._repository.list_deleted(
            start_at=start_at,
            end_at=end_at,
            created_start_at=created_start_at,
            created_end_at=created_end_at,
            updated_start_at=updated_start_at,
            updated_end_at=updated_end_at,
            category=category,
            location=location,
        )

    def conflicts(
        self,
        start_at: int,
        end_at: int,
        exclude_id: int | None = None,
    ) -> list[Schedule]:
        """Return schedules conflicting with an epoch window."""

        self._validate_window(start_at, end_at)
        conflict = self._repository.find_conflict(start_at, end_at, exclude_id=exclude_id)
        return [] if conflict is None else [conflict]

    def stats(self, start_at: int | None = None, end_at: int | None = None) -> dict[str, object]:
        """Return schedule statistics for an optional overlap range."""

        validate_optional_range(start_at, end_at, start_name="start_at", end_name="end_at")
        schedules = self._repository.list_range(start_at=start_at, end_at=end_at)
        by_category: dict[str, dict[str, int]] = defaultdict(lambda: {"count": 0, "duration": 0})
        total_duration = 0

        for schedule in schedules:
            duration = schedule.end_at - schedule.start_at
            category = schedule.category or ""
            by_category[category]["count"] += 1
            by_category[category]["duration"] += duration
            total_duration += duration

        return {
            "total": len(schedules),
            "total_duration": total_duration,
            "by_category": dict(sorted(by_category.items())),
        }

    def _validate_window(self, start_at: int, end_at: int) -> None:
        if start_at < 0:
            raise ValidationError("schedule start_at cannot be negative")
        if end_at < 0:
            raise ValidationError("schedule end_at cannot be negative")
        if start_at >= end_at:
            raise ValidationError("schedule start_at must be earlier than end_at")


def _schedule_sort_value(schedule: Schedule, sort_by: str) -> object:
    """Extract sort value from a Schedule entity."""
    if sort_by == "updated_at":
        return schedule.updated_at if schedule.updated_at is not None else schedule.created_at
    if sort_by == "duration":
        return schedule.end_at - schedule.start_at
    return getattr(schedule, sort_by)
