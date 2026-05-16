"""Unit of work composition helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Self

from models.factory import STANDALONE_USER_ID, get_standalone_tables, get_user_tables
from repositories import (
    NotificationMentionRepository,
    NotificationRepository,
    ScheduleAttachmentRepository,
    ScheduleChangelogRepository,
    ScheduleRepository,
    SettingsRepository,
    TodoAttachmentRepository,
    TodoChangelogRepository,
    TodoRepository,
)
from services.changelogs import ScheduleChangelogService, TodoChangelogService

if TYPE_CHECKING:
    from types import TracebackType

    from sqlalchemy.orm import Session

    from db.engine import Database


class UnitOfWork:
    """Coordinates a transaction and its repositories."""

    def __init__(self, database: Database, user_id: int = STANDALONE_USER_ID) -> None:
        self._database = database
        self._user_id = user_id
        self._session: Session | None = None

        if user_id == STANDALONE_USER_ID:
            (
                self._todo_model,
                self._schedule_model,
                self._setting_model,
                self._attachment_model,
                self._schedule_attachment_model,
                self._todo_changelog_model,
                self._schedule_changelog_model,
                self._notification_model,
                self._notification_mention_model,
            ) = get_standalone_tables()
        else:
            (
                self._todo_model,
                self._schedule_model,
                self._setting_model,
                self._attachment_model,
                self._schedule_attachment_model,
                self._todo_changelog_model,
                self._schedule_changelog_model,
                self._notification_model,
                self._notification_mention_model,
            ) = get_user_tables(user_id)

    def __enter__(self) -> Self:
        self._session = self._database.session_factory()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._session is None:
            return
        if exc_type is None:
            self._session.commit()
        else:
            self._session.rollback()
        self._session.close()
        self._session = None

    @property
    def session(self) -> Session:
        """Return the active session."""

        if self._session is None:
            msg = "unit of work has not been entered"
            raise RuntimeError(msg)
        return self._session

    @property
    def todo_model(self) -> type:
        """Return the ToDo model class for the current user."""
        return self._todo_model

    @property
    def schedule_model(self) -> type:
        """Return the schedule model class for the current user."""
        return self._schedule_model

    @property
    def setting_model(self) -> type:
        """Return the setting model class for the current user."""
        return self._setting_model

    @property
    def attachment_model(self) -> type:
        """Return the attachment model class for the current user."""
        return self._attachment_model

    @property
    def schedule_attachment_model(self) -> type:
        """Return the schedule attachment model class for the current user."""
        return self._schedule_attachment_model

    @property
    def todo_changelog_model(self) -> type:
        """Return the todo changelog model class for the current user."""
        return self._todo_changelog_model

    @property
    def schedule_changelog_model(self) -> type:
        """Return the schedule changelog model class for the current user."""
        return self._schedule_changelog_model

    @property
    def notification_model(self) -> type:
        """Return the notification model class for the current user."""
        return self._notification_model

    @property
    def notification_mention_model(self) -> type:
        """Return the notification mention model class for the current user."""
        return self._notification_mention_model

    @property
    def user_id(self) -> int:
        """Return the user id represented by this unit of work."""
        return self._user_id

    @property
    def attachments(self) -> TodoAttachmentRepository:
        """Return the attachment repository for the active session."""

        return TodoAttachmentRepository(self.session, self._attachment_model)

    @property
    def schedule_attachments(self) -> ScheduleAttachmentRepository:
        """Return the schedule attachment repository for the active session."""

        return ScheduleAttachmentRepository(self.session, self._schedule_attachment_model)

    @property
    def schedules(self) -> ScheduleRepository:
        """Return the schedule repository for the active session."""

        return ScheduleRepository(self.session, self._schedule_model)

    @property
    def settings(self) -> SettingsRepository:
        """Return the settings repository for the active session."""

        return SettingsRepository(self.session, self._setting_model)

    @property
    def todos(self) -> TodoRepository:
        """Return the ToDo repository for the active session."""

        return TodoRepository(self.session, self._todo_model)

    @property
    def todo_changelogs(self) -> TodoChangelogRepository:
        """Return the todo changelog repository for the active session."""
        return TodoChangelogRepository(self.session, self._todo_changelog_model)

    @property
    def todo_changelog_service(self) -> TodoChangelogService:
        """Return the todo changelog service for the active session."""
        from clock import SystemClock
        return TodoChangelogService(self.todo_changelogs, SystemClock(), self._todo_changelog_model)

    @property
    def schedule_changelogs(self) -> ScheduleChangelogRepository:
        """Return the schedule changelog repository for the active session."""
        return ScheduleChangelogRepository(self.session, self._schedule_changelog_model)

    @property
    def schedule_changelog_service(self) -> ScheduleChangelogService:
        """Return the schedule changelog service for the active session."""
        from clock import SystemClock
        return ScheduleChangelogService(self.schedule_changelogs, SystemClock(), self._schedule_changelog_model)

    @property
    def notifications(self) -> NotificationRepository:
        """Return the notification repository for the active session."""
        return NotificationRepository(self.session, self._notification_model)

    @property
    def notification_mentions(self) -> NotificationMentionRepository:
        """Return the notification mention repository for the active session."""
        return NotificationMentionRepository(self.session, self._notification_mention_model)
