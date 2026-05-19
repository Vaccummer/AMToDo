"""Import smoke tests for the project framework."""

from __future__ import annotations

import os

from config import load_cli_settings, load_settings
from services import create_application_context


def test_load_settings(tmp_path) -> None:
    """Settings can be loaded without touching persistent storage."""

    os.environ["AMTODO_SERVER_ROOT"] = str(tmp_path)
    try:
        settings = load_settings()
    finally:
        del os.environ["AMTODO_SERVER_ROOT"]

    assert settings.language
    assert settings.timezone


def test_create_application_context(tmp_path) -> None:
    """Application context can be composed."""

    os.environ["AMTODO_SERVER_ROOT"] = str(tmp_path)
    try:
        context = create_application_context()
    finally:
        del os.environ["AMTODO_SERVER_ROOT"]

    assert context.settings.database_url


def test_load_cli_settings(tmp_path) -> None:
    """CLI settings can be loaded from cli.toml or fall back to defaults."""

    os.environ["AMTODO_CLI_ROOT"] = str(tmp_path)
    try:
        settings = load_cli_settings()
    finally:
        del os.environ["AMTODO_CLI_ROOT"]

    assert settings.database_url
    # Without cli.toml and without server_url, defaults to local SQLite
    assert "sqlite" in settings.database_url
