"""ORM model registry."""

from __future__ import annotations

from models.attachment import TodoAttachment
from models.changelog import ScheduleChangelog, TodoChangelog
from models.notification import Notification
from models.notification_mention import NotificationMention
from models.schedule import Schedule
from models.schedule_attachment import ScheduleAttachment
from models.setting import Setting
from models.todo import Todo
from models.user import User

__all__ = [
    "Notification",
    "NotificationMention",
    "Schedule",
    "ScheduleAttachment",
    "ScheduleChangelog",
    "Setting",
    "Todo",
    "TodoAttachment",
    "TodoChangelog",
    "User",
    "register_models",
]


def register_models() -> None:
    """Import models and register concrete standalone tables with metadata."""

    from models.factory import get_standalone_tables

    get_standalone_tables()
