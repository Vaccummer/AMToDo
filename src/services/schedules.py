"""Schedule service boundaries."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from exceptions import ConflictError, NotFoundError, ValidationError
from models import Schedule

if TYPE_CHECKING:
    from repositories import ScheduleRepository
    from clock import Clock


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
    """Input data for updating a schedule item."""

    title: str | None = None
    start_at: int | None = None
    end_at: int | None = None
    description: str | None = None
    location: str | None = None
    category: str | None = None


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
        pattern: str,
        start_at: int | None = None,
        end_at: int | None = None,
        *,
        case_sensitive: bool = True,
    ) -> list[Schedule]:
        """Search schedules using a regular expression and optional epoch bounds."""

        self._validate_optional_range(start_at, end_at)
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags=flags)
        except re.error as exc:
            msg = f"invalid regex pattern: {exc}"
            raise ValidationError(msg) from exc

        schedules = self._repository.list_range(start_at=start_at, end_at=end_at)
        return [schedule for schedule in schedules if regex.search(_search_text(schedule))]

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


def _search_text(schedule: Schedule) -> str:
    return "\n".join(
        value
        for value in (
            schedule.title,
            schedule.description or "",
            schedule.location or "",
            schedule.category or "",
        )
        if value
    )
