"""UI import smoke tests."""

from __future__ import annotations


def test_todo_view_can_be_imported() -> None:
    """ToDo UI module can be imported without starting the app."""

    from ui.todo_view import TodoView

    assert TodoView.__name__ == "TodoView"
