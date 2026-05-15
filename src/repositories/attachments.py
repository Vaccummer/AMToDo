"""ToDo attachment repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class AttachmentRepository:
    """Data access for ToDo attachment rows."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def add(self, attachment: object) -> object:
        """Persist an attachment row."""

        self._session.add(attachment)
        return attachment

    def remove(self, attachment: object) -> None:
        """Delete an attachment row."""

        self._session.delete(attachment)

    def get(self, attachment_id: int) -> object | None:
        """Return an attachment by id if it exists."""

        return self._session.get(self._model, attachment_id)

    def list_for_todo(self, todo_id: int) -> list[object]:
        """Return attachments for a ToDo ordered by file index."""

        statement = (
            select(self._model)
            .where(self._model.todo_id == todo_id)
            .order_by(self._model.file_index, self._model.id)
        )
        return list(self._session.scalars(statement))

    def next_file_index(self, todo_id: int) -> int:
        """Return the next append-only file index for a ToDo."""

        statement = select(func.max(self._model.file_index)).where(self._model.todo_id == todo_id)
        current = self._session.scalar(statement)
        if current is None:
            return 0
        return int(current) + 1
