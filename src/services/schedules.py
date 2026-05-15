"""Schedule service boundaries."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from exceptions import ConflictError, NotFoundError, ValidationError
from models import Schedule

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

    def __init__(self, repository: ScheduleRepository, clock: Clock, model_class: type) -> None:
        self._repository = repository
        self._clock = clock
        self._model = model_class

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
        return self._repository.add(schedule)

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

        resolved_fields = _validate_fields(
            fields,
            SCHEDULE_SEARCH_FIELDS,
            "schedule search fields",
        )
        _validate_sort(sort_by, sort_order, SCHEDULE_SORT_FIELDS)
        self._validate_optional_range(start_at, end_at)
        _validate_optional_range_names(
            created_start_at,
            created_end_at,
            start_name="created_start_at",
            end_name="created_end_at",
        )
        _validate_optional_range_names(
            updated_start_at,
            updated_end_at,
            start_name="updated_start_at",
            end_name="updated_end_at",
        )
        regex = _compile_search_query(query, use_regex=use_regex, ignore_case=ignore_case)

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
            if regex.search(_search_text(schedule, resolved_fields))
        ]
        return _sort_results(matched, sort_by=sort_by, sort_order=sort_order)

    def update(self, schedule_id: int, update: ScheduleUpdate) -> Schedule:
        """Update mutable schedule fields while preserving conflict checks."""

        schedule = self.show(schedule_id)
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
        return schedule

    def remove(self, schedule_id: int) -> Schedule:
        """Remove a schedule by id."""

        schedule = self.show(schedule_id)
        self._repository.remove(schedule)
        return schedule

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

        self._validate_optional_range(start_at, end_at)
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

    def _validate_optional_range(self, start_at: int | None, end_at: int | None) -> None:
        if start_at is not None and start_at < 0:
            raise ValidationError("start_at cannot be negative")
        if end_at is not None and end_at < 0:
            raise ValidationError("end_at cannot be negative")
        if start_at is not None and end_at is not None and start_at >= end_at:
            raise ValidationError("start_at must be earlier than end_at")


def _search_text(schedule: Schedule, fields: list[str]) -> str:
    return "\n".join(
        str(value)
        for value in (getattr(schedule, field) or "" for field in fields)
        if value
    )


def _compile_search_query(query: str, *, use_regex: bool, ignore_case: bool) -> re.Pattern[str]:
    flags = re.IGNORECASE if ignore_case else 0
    pattern = query if use_regex else re.escape(query)
    try:
        return re.compile(pattern, flags=flags)
    except re.error as exc:
        msg = f"invalid regex pattern: {exc}"
        raise ValidationError(msg) from exc


def _validate_fields(
    fields: list[str] | None,
    allowed: frozenset[str],
    label: str,
) -> list[str]:
    resolved = list(fields) if fields is not None else sorted(allowed)
    if not resolved:
        raise ValidationError(f"{label} cannot be empty")
    unknown = sorted(set(resolved) - allowed)
    if unknown:
        raise ValidationError(f"unknown {label}: {', '.join(unknown)}")
    return resolved


def _validate_sort(
    sort_by: str,
    sort_order: str,
    allowed: frozenset[str],
) -> None:
    if sort_by not in allowed:
        raise ValidationError(f"unknown sort_by: {sort_by}")
    if sort_order not in {"asc", "desc"}:
        raise ValidationError("sort_order must be 'asc' or 'desc'")


def _validate_optional_range_names(
    start_at: int | None,
    end_at: int | None,
    *,
    start_name: str,
    end_name: str,
) -> None:
    if start_at is not None and start_at < 0:
        raise ValidationError(f"{start_name} cannot be negative")
    if end_at is not None and end_at < 0:
        raise ValidationError(f"{end_name} cannot be negative")
    if start_at is not None and end_at is not None and start_at >= end_at:
        raise ValidationError(f"{start_name} must be earlier than {end_name}")


def _sort_results(
    schedules: list[Schedule],
    *,
    sort_by: str,
    sort_order: str,
) -> list[Schedule]:
    descending = sort_order == "desc"
    return sorted(
        schedules,
        key=lambda schedule: _sort_key(schedule, sort_by, descending=descending),
        reverse=descending,
    )


def _sort_key(
    schedule: Schedule,
    sort_by: str,
    *,
    descending: bool,
) -> tuple[bool, Any]:
    value = _sort_value(schedule, sort_by)
    if isinstance(value, str):
        value = value.casefold()
    if descending:
        return (value is not None, value if value is not None else _empty_sort_value(sort_by))
    return (value is None, value if value is not None else _empty_sort_value(sort_by))


def _sort_value(schedule: Schedule, sort_by: str) -> object:
    if sort_by == "updated_at":
        return schedule.updated_at if schedule.updated_at is not None else schedule.created_at
    if sort_by == "duration":
        return schedule.end_at - schedule.start_at
    return getattr(schedule, sort_by)


def _empty_sort_value(sort_by: str) -> object:
    if sort_by == "title":
        return ""
    return 0
