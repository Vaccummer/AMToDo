"""Dynamic ORM class factory for per-user tables."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index

STANDALONE_USER_ID = 0

_cache: dict[int, tuple[type, type, type]] = {}


def get_standalone_tables() -> tuple[type, type, type]:
    """Return concrete model classes for standalone (non-multi-user) usage."""
    if STANDALONE_USER_ID in _cache:
        return _cache[STANDALONE_USER_ID]

    from models.schedule import Schedule
    from models.setting import Setting
    from models.todo import Todo

    StandaloneTodo = type(
        "Todo_standalone",
        (Todo,),
        {
            "__tablename__": "todos",
            "__table_args__": (
                Index("ix_todos_due_completed", "due_at", "completed"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    StandaloneSchedule = type(
        "Schedule_standalone",
        (Schedule,),
        {
            "__tablename__": "schedules",
            "__table_args__": (
                CheckConstraint(
                    "start_at < end_at", name="ck_schedules_time_window"
                ),
                Index("ix_schedules_time_window", "start_at", "end_at"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    StandaloneSetting = type(
        "Setting_standalone",
        (Setting,),
        {"__tablename__": "settings"},
    )
    result = (StandaloneTodo, StandaloneSchedule, StandaloneSetting)
    _cache[STANDALONE_USER_ID] = result
    return result


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
            "__table_args__": ({"sqlite_autoincrement": True},),
        },
    )
    ScheduleModel = type(
        f"Schedule_{user_id}",
        (Schedule,),
        {
            "__tablename__": schedule_table,
            "__table_args__": ({"sqlite_autoincrement": True},),
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
