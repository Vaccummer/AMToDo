"""Repository adapters for persistent storage."""

from __future__ import annotations

from repositories.attachments import (
    ScheduleAttachmentRepository,
    TodoAttachmentRepository,
)
from repositories.changelogs import (
    ScheduleChangelogRepository,
    TodoChangelogRepository,
)
from repositories.notifications import (
    NotificationMentionRepository,
    NotificationRepository,
)
from repositories.schedules import ScheduleRepository
from repositories.settings import SettingsRepository
from repositories.todos import TodoRepository

__all__ = [
    "NotificationMentionRepository",
    "NotificationRepository",
    "ScheduleAttachmentRepository",
    "ScheduleChangelogRepository",
    "ScheduleRepository",
    "SettingsRepository",
    "TodoAttachmentRepository",
    "TodoChangelogRepository",
    "TodoRepository",
]
