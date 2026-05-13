"""Settings repository."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


class SettingsRepository:
    """Data access for key-value settings."""

    def __init__(self, session: Session, model_class: type) -> None:
        self._session = session
        self._model = model_class

    def get(self, key: str) -> str | None:
        """Return a stored setting value."""

        setting = self._session.get(self._model, key)
        if setting is None:
            return None
        return setting.value

    def set(self, key: str, value: str) -> object:
        """Create or update a stored setting value."""

        setting = self._session.get(self._model, key)
        if setting is None:
            setting = self._model(key=key, value=value)
            self._session.add(setting)
        else:
            setting.value = value
        return setting
