"""ToDo service tests."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from clock import FixedClock
from config import AppSettings
from dates import day_after, day_start_epoch
from db.engine import create_database
from exceptions import NotFoundError, ValidationError
from services import TodoDraft, TodoService, TodoUpdate
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from pathlib import Path

    from db.engine import Database


TIMEZONE = "Asia/Shanghai"


def test_create_and_complete_todo(tmp_path: Path) -> None:
    """A ToDo can be created and marked completed."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE) + 3600)
    due_at = clock.epoch + 123

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        todo = service.create(
            TodoDraft(
                title="  Write tests  ",
                due_at=due_at,
                priority=2,
                tag="dev",
            )
        )
        uow.session.flush()
        todo_id = todo.id
        assert todo.due_at == due_at

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        completed = service.complete(todo_id)

        assert completed.completed is True
        assert completed.completed_at == clock.epoch
        assert completed.title == "Write tests"


def test_complete_missing_todo_raises(tmp_path: Path) -> None:
    """Completing an unknown ToDo reports a domain error."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)

        try:
            service.complete(999)
        except NotFoundError:
            return

    msg = "expected NotFoundError"
    raise AssertionError(msg)


def test_show_update_and_reopen_todo(tmp_path: Path) -> None:
    """A ToDo can be shown, updated, completed, and reopened."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))
    new_due_at = clock.epoch + 500

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        todo = service.create(TodoDraft(title="Draft title", due_at=clock.epoch))
        uow.session.flush()
        todo_id = todo.id

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        shown = service.show(todo_id)
        updated = service.update(
            todo_id,
            TodoUpdate(
                title="Updated title",
                due_at=new_due_at,
                description="Updated details",
                priority=3,
                tag="updated",
            ),
        )
        completed = service.complete(todo_id)
        assert completed.completed is True
        reopened = service.reopen(todo_id)

        assert shown.id == todo_id
        assert updated.title == "Updated title"
        assert updated.due_at == new_due_at
        assert updated.description == "Updated details"
        assert updated.priority == 3
        assert updated.tag == "updated"
        assert reopened.completed is False
        assert reopened.completed_at is None


def test_incomplete_overdue_todos_keep_original_due_at(tmp_path: Path) -> None:
    """Planned-date listing does not mutate an overdue ToDo's due timestamp."""

    database = _create_test_database(tmp_path)
    today = date(2026, 5, 11)
    yesterday_at = day_start_epoch(date(2026, 5, 10), TIMEZONE)
    today_at = day_start_epoch(today, TIMEZONE)
    tomorrow_at = day_start_epoch(day_after(today, 1), TIMEZONE)
    clock = FixedClock(today_at + 3600)

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        open_todo = service.create(TodoDraft(title="Carry me", due_at=yesterday_at))
        uow.session.flush()
        open_id = open_todo.id

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        listed = service.list_between(today_at, tomorrow_at)
        overdue_todo = uow.todos.get(open_id)

        assert [todo.id for todo in listed] == [open_id]
        assert overdue_todo is not None
        assert overdue_todo.due_at == yesterday_at


def test_remove_deletes_todo_and_ids_are_not_reused(tmp_path: Path) -> None:
    """Removing a ToDo deletes it without allowing SQLite to reuse its id."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        first = service.create(TodoDraft(title="Remove me", due_at=clock.epoch))
        uow.session.flush()
        first_id = first.id
        removed = service.remove(first_id)

        assert removed.id == first_id

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        second = service.create(TodoDraft(title="New item", due_at=clock.epoch))
        uow.session.flush()

        assert uow.todos.get(first_id) is None
        assert second.id > first_id


def test_search_matches_regex_and_optional_epoch_bounds(tmp_path: Path) -> None:
    """Search matches ToDo text with optional planned timestamp bounds."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))
    before_at = clock.epoch - 86_400
    inside_at = clock.epoch
    after_at = clock.epoch + 86_400

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        service.create(TodoDraft(title="Read paper", planned_at=before_at, tag="study"))
        inside = service.create(
            TodoDraft(
                title="Write project plan",
                planned_at=inside_at,
                description="Planning notes",
                tag="planning",
            )
        )
        service.create(TodoDraft(title="Buy coffee", planned_at=after_at, tag="errand"))
        uow.session.flush()
        inside_id = inside.id

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        all_matches = service.search("plan|study")
        bounded_matches = service.search(
            "plan|study",
            planned_start_at=inside_at,
            planned_end_at=after_at,
        )

        assert [todo.title for todo in all_matches] == ["Read paper", "Write project plan"]
        assert [todo.id for todo in bounded_matches] == [inside_id]


def test_search_can_filter_by_planned_and_created_ranges(tmp_path: Path) -> None:
    """Search can combine planned_at and created_at bounds."""

    database = _create_test_database(tmp_path)
    planned_at = day_start_epoch(date(2026, 5, 11), TIMEZONE)
    created_before = planned_at - 86_400
    created_inside = planned_at + 3600
    planned_end = planned_at + 86_400

    with UnitOfWork(database) as uow:
        old_service = TodoService(uow.todos, FixedClock(created_before), uow.todo_model)
        old_service.create(TodoDraft(title="Shared old", planned_at=planned_at))
        new_service = TodoService(uow.todos, FixedClock(created_inside), uow.todo_model)
        inside = new_service.create(TodoDraft(title="Shared new", planned_at=planned_at))
        uow.session.flush()
        inside_id = inside.id

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, FixedClock(created_inside), uow.todo_model)
        matches = service.search(
            "Shared",
            planned_start_at=planned_at,
            planned_end_at=planned_end,
            created_start_at=planned_at,
            created_end_at=planned_end,
        )

        assert [todo.id for todo in matches] == [inside_id]


def test_list_and_search_can_filter_by_completion(tmp_path: Path) -> None:
    """List and search can limit results by completion state."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        open_todo = service.create(TodoDraft(title="Shared open", due_at=clock.epoch))
        completed_todo = service.create(TodoDraft(title="Shared completed", due_at=clock.epoch))
        uow.session.flush()
        service.complete(completed_todo.id)

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        open_list = service.list_between(clock.epoch, clock.epoch + 1, completed=False)
        completed_list = service.list_between(clock.epoch, clock.epoch + 1, completed=True)
        open_search = service.search("Shared", completed=False)
        completed_search = service.search("Shared", completed=True)

        assert [todo.id for todo in open_list] == [open_todo.id]
        assert [todo.id for todo in completed_list] == [completed_todo.id]
        assert [todo.id for todo in open_search] == [open_todo.id]
        assert [todo.id for todo in completed_search] == [completed_todo.id]


def test_search_case_sensitivity_is_configurable(tmp_path: Path) -> None:
    """Search is case-sensitive by default and can be made case-insensitive."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        service.create(TodoDraft(title="Write Project Plan", due_at=clock.epoch))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        sensitive_matches = service.search("project")
        insensitive_matches = service.search("project", case_sensitive=False)

        assert sensitive_matches == []
        assert [todo.title for todo in insensitive_matches] == ["Write Project Plan"]


def test_search_rejects_invalid_regex(tmp_path: Path) -> None:
    """Invalid regex patterns surface as validation errors."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)

        try:
            service.search("[")
        except ValidationError:
            return

    msg = "expected ValidationError"
    raise AssertionError(msg)


def test_stats_counts_totals_and_tags(tmp_path: Path) -> None:
    """Stats summarize totals, completion state, and tags."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        service.create(TodoDraft(title="Open work", due_at=clock.epoch, tag="work"))
        done = service.create(TodoDraft(title="Done work", due_at=clock.epoch, tag="work"))
        service.create(TodoDraft(title="Open untagged", due_at=clock.epoch))
        uow.session.flush()
        service.complete(done.id)

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)
        stats = service.stats(start_at=clock.epoch, end_at=clock.epoch + 1)

        assert stats == {
            "total": 3,
            "open": 2,
            "completed": 1,
            "by_tag": {"": 1, "work": 2},
        }


def test_create_rejects_empty_title(tmp_path: Path) -> None:
    """A ToDo title must contain visible text."""

    database = _create_test_database(tmp_path)
    clock = FixedClock(day_start_epoch(date(2026, 5, 11), TIMEZONE))

    with UnitOfWork(database) as uow:
        service = TodoService(uow.todos, clock, uow.todo_model)

        try:
            service.create(TodoDraft(title="   ", due_at=clock.epoch))
        except ValidationError:
            return

    msg = "expected ValidationError"
    raise AssertionError(msg)


def _create_test_database(tmp_path: Path) -> Database:
    settings = AppSettings(database_url=f"sqlite:///{tmp_path / 'test.sqlite3'}")
    database = create_database(settings)
    database.create_schema()
    return database
