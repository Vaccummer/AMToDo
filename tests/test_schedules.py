"""Schedule service tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from config import AppSettings
from db.engine import create_database
from exceptions import ConflictError, NotFoundError, ValidationError
from services import ScheduleDraft, ScheduleService, ScheduleUpdate
from services.uow import UnitOfWork
from clock import FixedClock

if TYPE_CHECKING:
    from pathlib import Path

    from db.engine import Database


TIMEZONE = "Asia/Shanghai"


def test_create_list_and_show_schedule(tmp_path: Path) -> None:
    """A schedule can be created, listed by overlap, and shown by id."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        schedule = service.create(
            ScheduleDraft(
                title="  Math class  ",
                start_at=100,
                end_at=200,
                timezone=TIMEZONE,
                location="A101",
                category="course",
            )
        )
        uow.session.flush()
        schedule_id = schedule.id

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        listed = service.list_between(150, 250)
        shown = service.show(schedule_id)

        assert [item.id for item in listed] == [schedule_id]
        assert shown.title == "Math class"
        assert shown.location == "A101"
        assert shown.category == "course"


def test_conflicting_schedule_is_rejected_but_adjacent_is_allowed(tmp_path: Path) -> None:
    """Overlapping schedules conflict, while touching boundaries are allowed."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        service.create(ScheduleDraft(title="Morning", start_at=100, end_at=200, timezone=TIMEZONE))
        adjacent = service.create(
            ScheduleDraft(title="Next", start_at=200, end_at=300, timezone=TIMEZONE)
        )

        try:
            service.create(
                ScheduleDraft(title="Overlap", start_at=150, end_at=250, timezone=TIMEZONE)
            )
        except ConflictError:
            assert adjacent.start_at == 200
            return

    msg = "expected ConflictError"
    raise AssertionError(msg)


def test_update_checks_conflicts_and_remove_deletes_schedule(tmp_path: Path) -> None:
    """Schedule updates validate conflicts and remove deletes by id."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        first = service.create(
            ScheduleDraft(title="First", start_at=100, end_at=200, timezone=TIMEZONE)
        )
        second = service.create(
            ScheduleDraft(title="Second", start_at=200, end_at=300, timezone=TIMEZONE)
        )
        uow.session.flush()
        first_id = first.id
        second_id = second.id

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        updated = service.update(
            first_id,
            ScheduleUpdate(title="Updated", start_at=50, end_at=150, location="B202"),
        )

        assert updated.title == "Updated"
        assert updated.start_at == 50
        assert updated.end_at == 150
        assert updated.location == "B202"

        conflict_seen = False
        try:
            service.update(first_id, ScheduleUpdate(start_at=250, end_at=280))
        except ConflictError:
            conflict_seen = True
            removed = service.remove(second_id)
            assert removed.id == second_id

        assert conflict_seen is True

    with UnitOfWork(database) as uow:
        assert uow.schedules.get(second_id) is None


def test_search_conflicts_and_stats(tmp_path: Path) -> None:
    """Search, conflict probing, and stats use optional ranges."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        math = service.create(
            ScheduleDraft(
                title="Math class",
                start_at=100,
                end_at=200,
                timezone=TIMEZONE,
                location="A101",
                category="course",
            )
        )
        service.create(
            ScheduleDraft(
                title="Project sync",
                start_at=300,
                end_at=360,
                timezone=TIMEZONE,
                category="meeting",
            )
        )
        uow.session.flush()
        math_id = math.id

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        search_matches = service.search(
            "math|sync",
            use_regex=True,
            start_at=0,
            end_at=400,
        )
        conflicts = service.conflicts(150, 180)
        no_conflicts = service.conflicts(200, 300)
        stats = service.stats(start_at=0, end_at=400)

        assert [item.title for item in search_matches] == ["Math class", "Project sync"]
        assert [item.id for item in conflicts] == [math_id]
        assert no_conflicts == []
        assert stats == {
            "total": 2,
            "total_duration": 160,
            "by_category": {
                "course": {"count": 1, "duration": 100},
                "meeting": {"count": 1, "duration": 60},
            },
        }


def test_search_fields_filters_and_sorting(tmp_path: Path) -> None:
    """Search can choose fields, filter scalar values, and sort results."""

    database = _create_test_database(tmp_path)

    with UnitOfWork(database) as uow:
        first_service = ScheduleService(uow.schedules, FixedClock(100), uow.schedule_model)
        first_service.create(
            ScheduleDraft(
                title="Planning",
                start_at=100,
                end_at=200,
                timezone=TIMEZONE,
                location="Room A",
                category="work",
            )
        )
        second_service = ScheduleService(uow.schedules, FixedClock(200), uow.schedule_model)
        second_service.create(
            ScheduleDraft(
                title="Review",
                start_at=300,
                end_at=360,
                timezone=TIMEZONE,
                location="Room B",
                category="work",
            )
        )

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, FixedClock(300), uow.schedule_model)
        matches = service.search(
            "room",
            fields=["location"],
            category="work",
            sort_by="duration",
            sort_order="desc",
        )

        assert [schedule.title for schedule in matches] == ["Planning", "Review"]


def test_show_missing_and_invalid_window_raise_domain_errors(tmp_path: Path) -> None:
    """Missing ids and invalid windows report domain errors."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)

        try:
            service.show(999)
        except NotFoundError:
            pass
        else:
            msg = "expected NotFoundError"
            raise AssertionError(msg)

        try:
            service.create(ScheduleDraft(title="Bad", start_at=200, end_at=100, timezone=TIMEZONE))
        except ValidationError:
            return

    msg = "expected ValidationError"
    raise AssertionError(msg)


def test_soft_delete_and_restore_schedule(tmp_path: Path) -> None:
    """A soft-deleted schedule is hidden from normal queries but can be restored."""
    from services.uow import UnitOfWork

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        schedule = service.create(
            ScheduleDraft(title="Trash me", start_at=100, end_at=200, timezone=TIMEZONE)
        )
        uow.session.flush()
        schedule_id = schedule.id

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        removed = service.remove(schedule_id)
        assert removed.deleted_at == clock.epoch

        # Hidden from normal queries
        assert uow.schedules.get(schedule_id) is None

        # Visible in trash
        deleted = service.list_deleted()
        assert len(deleted) == 1
        assert deleted[0].id == schedule_id

        # Restore
        restored = service.restore(schedule_id)
        assert restored.deleted_at is None
        assert uow.schedules.get(schedule_id) is not None


def test_purge_permanently_deletes_schedule(tmp_path: Path) -> None:
    """Purge permanently removes a soft-deleted schedule."""
    from services.uow import UnitOfWork

    database = _create_test_database(tmp_path)
    clock = FixedClock(1_778_400_000)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        schedule = service.create(
            ScheduleDraft(title="Purge me", start_at=100, end_at=200, timezone=TIMEZONE)
        )
        uow.session.flush()
        schedule_id = schedule.id
        service.remove(schedule_id)

    with UnitOfWork(database) as uow:
        service = ScheduleService(uow.schedules, clock, uow.schedule_model)
        purged = service.purge(schedule_id)
        assert purged.id == schedule_id
        assert uow.schedules.get_including_deleted(schedule_id) is None


def _create_test_database(tmp_path: Path) -> Database:
    settings = AppSettings(database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}")
    database = create_database(settings)
    database.create_schema()
    return database
