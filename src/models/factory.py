"""Dynamic ORM class factory for per-user tables."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index

STANDALONE_USER_ID = 0

_cache: dict[int, tuple[type, type, type]] = {}


def get_user_tables(user_id: int) -> tuple[type, type, type]:
    """Return (TodoModel, ScheduleModel, SettingModel) with per-user table names."""
    if user_id in _cache:
        return _cache[user_id]

    from models.schedule import Schedule
    from models.setting import Setting
    from models.todo import Todo

    todo_table = f"todos_{user_id}"
    schedule_table = f"schedules_{user_id}"

    TodoModel = type(
        f"Todo_{user_id}",
        (Todo,),
        {
            "__tablename__": todo_table,
            "__table_args__": (
                Index(f"ix_{todo_table}_due_completed", "due_at", "completed"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    ScheduleModel = type(
        f"Schedule_{user_id}",
        (Schedule,),
        {
            "__tablename__": schedule_table,
            "__table_args__": (
                CheckConstraint(
                    "start_at < end_at", name=f"ck_{schedule_table}_time_window"
                ),
                Index(f"ix_{schedule_table}_time_window", "start_at", "end_at"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    SettingModel = type(
        f"Setting_{user_id}",
        (Setting,),
        {"__tablename__": f"settings_{user_id}"},
    )
    result = (TodoModel, ScheduleModel, SettingModel)
    _cache[user_id] = result
    return result


def get_standalone_tables() -> tuple[type, type, type]:
    """Return base model classes for standalone (non-multi-user) usage."""
    from models.schedule import Schedule
    from models.setting import Setting
    from models.todo import Todo

    return (Todo, Schedule, Setting)
