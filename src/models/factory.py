"""Dynamic ORM class factory for per-user tables."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

STANDALONE_USER_ID = 0

_cache: dict[int, tuple[type, type, type, type, type]] = {}


def get_standalone_tables() -> tuple[type, type, type, type, type]:
    """Return concrete model classes for standalone (non-multi-user) usage."""
    if STANDALONE_USER_ID in _cache:
        return _cache[STANDALONE_USER_ID]

    from models.attachment import TodoAttachment
    from models.schedule import Schedule
    from models.schedule_attachment import ScheduleAttachment
    from models.setting import Setting
    from models.todo import Todo

    StandaloneTodo = type(
        "Todo_standalone",
        (Todo,),
        {
            "__tablename__": "todos",
            "__table_args__": (
                Index("ix_todos_planned_completed", "planned_at", "completed"),
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
    StandaloneTodoAttachment = type(
        "TodoAttachment_standalone",
        (TodoAttachment,),
        {
            "__tablename__": "todo_attachments",
            "__table_args__": (
                UniqueConstraint(
                    "todo_id",
                    "file_index",
                    name="uq_todo_attachments_todo_file_index",
                ),
                Index("ix_todo_attachments_todo", "todo_id"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    StandaloneScheduleAttachment = type(
        "ScheduleAttachment_standalone",
        (ScheduleAttachment,),
        {
            "__tablename__": "schedule_attachments",
            "__table_args__": (
                UniqueConstraint(
                    "schedule_id",
                    "file_index",
                    name="uq_schedule_attachments_schedule_file_index",
                ),
                Index("ix_schedule_attachments_schedule", "schedule_id"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    result = (
        StandaloneTodo,
        StandaloneSchedule,
        StandaloneSetting,
        StandaloneTodoAttachment,
        StandaloneScheduleAttachment,
    )
    _cache[STANDALONE_USER_ID] = result
    return result


def get_user_tables(user_id: int) -> tuple[type, type, type, type, type]:
    """Return per-user table model classes."""

    if user_id in _cache:
        return _cache[user_id]

    from models.attachment import TodoAttachment
    from models.schedule import Schedule
    from models.schedule_attachment import ScheduleAttachment
    from models.setting import Setting
    from models.todo import Todo

    todo_table = f"todos_{user_id}"
    schedule_table = f"schedules_{user_id}"
    attachment_table = f"todo_attachments_{user_id}"
    schedule_attachment_table = f"schedule_attachments_{user_id}"

    TodoModel = type(
        f"Todo_{user_id}",
        (Todo,),
        {
            "__tablename__": todo_table,
            "__table_args__": (
                Index(f"ix_{todo_table}_planned_completed", "planned_at", "completed"),
                {"sqlite_autoincrement": True},
            ),
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
    TodoAttachmentModel = type(
        f"TodoAttachment_{user_id}",
        (TodoAttachment,),
        {
            "__tablename__": attachment_table,
            "__table_args__": (
                UniqueConstraint(
                    "todo_id",
                    "file_index",
                    name=f"uq_{attachment_table}_todo_file_index",
                ),
                Index(f"ix_{attachment_table}_todo", "todo_id"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    ScheduleAttachmentModel = type(
        f"ScheduleAttachment_{user_id}",
        (ScheduleAttachment,),
        {
            "__tablename__": schedule_attachment_table,
            "__table_args__": (
                UniqueConstraint(
                    "schedule_id",
                    "file_index",
                    name=f"uq_{schedule_attachment_table}_schedule_file_index",
                ),
                Index(f"ix_{schedule_attachment_table}_schedule", "schedule_id"),
                {"sqlite_autoincrement": True},
            ),
        },
    )
    result = (TodoModel, ScheduleModel, SettingModel, TodoAttachmentModel, ScheduleAttachmentModel)
    _cache[user_id] = result
    return result
