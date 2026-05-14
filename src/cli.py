"""Command-line entry point."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Annotated

import typer

from config import __version__, amtodo_root
from config import load_cli_settings
from exceptions import AMToDoError, ValidationError
from serialization import schedule_to_dict, todo_to_dict
from services import (
    ScheduleDraft,
    ScheduleService,
    ScheduleUpdate,
    TodoDraft,
    TodoService,
    TodoUpdate,
    create_application_context,
)
from services.uow import UnitOfWork

if TYPE_CHECKING:
    from collections.abc import Callable

    from models import Schedule, Todo

app = typer.Typer(invoke_without_command=True, no_args_is_help=True)
todo_app = typer.Typer(no_args_is_help=True)
schedule_app = typer.Typer(no_args_is_help=True)
user_app = typer.Typer(no_args_is_help=True)


@app.callback()
def root(
    version: bool = typer.Option(False, "--version", help="Show the application version."),
) -> None:
    """AMToDo command-line interface."""

    if version:
        typer.echo(__version__)
        raise typer.Exit


@app.command("init-db")
def init_db() -> None:
    """Create database tables for the current configuration."""

    settings = load_cli_settings()
    context = create_application_context(settings)
    context.database.create_schema()
    _echo_json({"ok": True, "database_url": context.settings.database_url})


@app.command("health")
def health() -> None:
    """Check server health status."""

    settings = load_cli_settings()
    _run_http(lambda client: client.health(), settings)


@app.command("agent-guide")
def agent_guide() -> None:
    """Return a machine-oriented description of all API endpoints for AI agents."""

    settings = load_cli_settings()
    _run_http(lambda client: client.agent_guide(), settings)


# ── todo commands ──


@todo_app.command("add")
def todo_add(
    title: str = typer.Argument(..., help="ToDo title."),
    planned_at: int | None = typer.Option(
        None,
        "--planned-at",
        help="Optional Unix epoch planning timestamp in seconds.",
    ),
    due_at: int | None = typer.Option(
        None,
        "--date",
        "-d",
        help="Optional Unix epoch due timestamp in seconds.",
    ),
    description: str | None = typer.Option(None, "--description", "-m", help="Optional details."),
    priority: int = typer.Option(0, "--priority", "-p", min=0, help="Higher values sort first."),
    tag: str | None = typer.Option(None, "--tag", "-t", help="Optional tag."),
) -> None:
    """Add a ToDo item."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_create(
            title=title,
            planned_at=planned_at,
            due_at=due_at,
            description=description,
            priority=priority,
            tag=tag,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            todo = service.create(
                TodoDraft(
                    title=title,
                    planned_at=planned_at,
                    due_at=due_at,
                    description=description,
                    priority=priority,
                    tag=tag,
                )
            )
            uow.session.flush()
            _echo_json({"ok": True, "todo": todo_to_dict(todo, context.settings.timezone)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_app.command("list")
def todo_list(
    start_at: int | None = typer.Option(
        None,
        "--from",
        "-f",
        help="Optional Unix epoch planned_at range start in seconds.",
    ),
    end_at: int | None = typer.Option(
        None,
        "--to",
        "-t",
        help="Optional Unix epoch planned_at range end in seconds.",
    ),
    open_only: bool = typer.Option(False, "--open", help="Only return open ToDos."),
    completed_only: bool = typer.Option(False, "--completed", help="Only return completed ToDos."),
) -> None:
    """List ToDos in an epoch range."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_list(
            start_at=start_at, end_at=end_at, open_only=open_only, completed_only=completed_only,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            completed = _completion_filter(open_only=open_only, completed_only=completed_only)
            if start_at is None and end_at is None:
                todos = service.list_all(completed=completed)
            else:
                resolved_start_at = start_at if start_at is not None else 0
                resolved_end_at = end_at if end_at is not None else context.clock.now_epoch() + 86_400
                todos = service.list_between(resolved_start_at, resolved_end_at, completed=completed)

        result: dict[str, object] = {
            "ok": True,
            "filter": {"completed": completed},
            "count": len(todos),
            "todos": [todo_to_dict(todo, context.settings.timezone) for todo in todos],
        }
        if start_at is not None or end_at is not None:
            result["range"] = {"start_at": start_at, "end_at": end_at}
        _echo_json(result)
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_app.command("search")
def todo_search(
    pattern: str = typer.Argument(..., help="Regular expression matched against ToDo text."),
    planned_start_at: int | None = typer.Option(
        None,
        "--from",
        "--planned-from",
        "-f",
        help="Optional Unix epoch planned_at range start in seconds.",
    ),
    planned_end_at: int | None = typer.Option(
        None,
        "--to",
        "--planned-to",
        "-t",
        help="Optional Unix epoch planned_at range end in seconds.",
    ),
    created_start_at: int | None = typer.Option(
        None,
        "--created-from",
        help="Optional Unix epoch created_at range start in seconds.",
    ),
    created_end_at: int | None = typer.Option(
        None,
        "--created-to",
        help="Optional Unix epoch created_at range end in seconds.",
    ),
    ignore_case: bool = typer.Option(
        False,
        "--ignore-case",
        help="Run regex search without case sensitivity.",
    ),
    open_only: bool = typer.Option(False, "--open", help="Only search open ToDos."),
    completed_only: bool = typer.Option(False, "--completed", help="Only search completed ToDos."),
) -> None:
    """Search ToDos with a regular expression."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_search(
            pattern=pattern,
            planned_start_at=planned_start_at,
            planned_end_at=planned_end_at,
            created_start_at=created_start_at,
            created_end_at=created_end_at,
            ignore_case=ignore_case, open_only=open_only, completed_only=completed_only,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            completed = _completion_filter(open_only=open_only, completed_only=completed_only)
            todos = service.search(
                pattern,
                planned_start_at=planned_start_at,
                planned_end_at=planned_end_at,
                created_start_at=created_start_at,
                created_end_at=created_end_at,
                completed=completed,
                case_sensitive=not ignore_case,
            )

        _echo_json(
            {
                "ok": True,
                "pattern": pattern,
                "case_sensitive": not ignore_case,
                "range": {
                    "planned_start_at": planned_start_at,
                    "planned_end_at": planned_end_at,
                    "created_start_at": created_start_at,
                    "created_end_at": created_end_at,
                },
                "filter": {"completed": completed},
                "count": len(todos),
                "todos": [todo_to_dict(todo, context.settings.timezone) for todo in todos],
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_app.command("show")
def todo_show(todo_id: int = typer.Argument(..., help="ToDo id.")) -> None:
    """Show a ToDo by id."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_get(todo_id), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            todo = service.show(todo_id)
            _echo_json({"ok": True, "todo": todo_to_dict(todo, context.settings.timezone)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_app.command("update")
def todo_update(
    todo_id: int = typer.Argument(..., help="ToDo id."),
    title: str | None = typer.Option(None, "--title", help="New title."),
    planned_at: int | None = typer.Option(
        None,
        "--planned-at",
        help="New Unix epoch planning timestamp.",
    ),
    due_at: int | None = typer.Option(None, "--date", "-d", help="New Unix epoch due timestamp."),
    description: str | None = typer.Option(None, "--description", "-m", help="New details."),
    priority: int | None = typer.Option(None, "--priority", "-p", min=0, help="New priority."),
    tag: str | None = typer.Option(None, "--tag", "-t", help="New tag."),
) -> None:
    """Update mutable ToDo fields."""

    settings = load_cli_settings()
    if settings.server_url:
        fields: dict[str, object] = {}
        if title is not None:
            fields["title"] = title
        if planned_at is not None:
            fields["planned_at"] = planned_at
        if due_at is not None:
            fields["due_at"] = due_at
        if description is not None:
            fields["description"] = description
        if priority is not None:
            fields["priority"] = priority
        if tag is not None:
            fields["tag"] = tag
        _run_http(lambda client: client.todo_update(todo_id, **fields), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            todo = service.update(
                todo_id,
                TodoUpdate(
                    title=title,
                    planned_at=planned_at,
                    due_at=due_at,
                    description=description,
                    priority=priority,
                    tag=tag,
                ),
            )
            uow.session.flush()
            _echo_json({"ok": True, "todo": todo_to_dict(todo, context.settings.timezone)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_app.command("done")
def todo_done(targets: Annotated[list[int], typer.Argument(help="ToDo id target(s).")]) -> None:
    """Mark one or more ToDos as completed."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_done(_unique_targets(targets)), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    with UnitOfWork(context.database) as uow:
        service = TodoService(uow.todos, context.clock, uow.todo_model)
        results = [
            _target_result(
                target,
                lambda current: service.complete(current),
                context.settings.timezone,
            )
            for target in _unique_targets(targets)
        ]
        uow.session.flush()

    _echo_json({"ok": all(result["ok"] for result in results), "results": results})


@todo_app.command("reopen")
def todo_reopen(targets: Annotated[list[int], typer.Argument(help="ToDo id target(s).")]) -> None:
    """Mark one or more ToDos as open."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_reopen(_unique_targets(targets)), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    with UnitOfWork(context.database) as uow:
        service = TodoService(uow.todos, context.clock, uow.todo_model)
        results = [
            _target_result(
                target,
                lambda current: service.reopen(current),
                context.settings.timezone,
            )
            for target in _unique_targets(targets)
        ]
        uow.session.flush()

    _echo_json({"ok": all(result["ok"] for result in results), "results": results})


@todo_app.command("remove")
def todo_remove(targets: Annotated[list[int], typer.Argument(help="ToDo id target(s).")]) -> None:
    """Remove one or more ToDos by id."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_remove(_unique_targets(targets)), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    with UnitOfWork(context.database) as uow:
        service = TodoService(uow.todos, context.clock, uow.todo_model)
        results = [
            _target_result(
                target,
                lambda current: service.remove(current),
                context.settings.timezone,
            )
            for target in _unique_targets(targets)
        ]

    _echo_json({"ok": all(result["ok"] for result in results), "results": results})


@todo_app.command("stats")
def todo_stats(
    start_at: int | None = typer.Option(
        None,
        "--from",
        "-f",
        help="Optional Unix epoch range start in seconds.",
    ),
    end_at: int | None = typer.Option(
        None,
        "--to",
        "-t",
        help="Optional Unix epoch range end in seconds.",
    ),
) -> None:
    """Return ToDo statistics."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_stats(start_at=start_at, end_at=end_at), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = TodoService(uow.todos, context.clock, uow.todo_model)
            stats = service.stats(start_at=start_at, end_at=end_at)

        _echo_json(
            {
                "ok": True,
                "range": {"start_at": start_at, "end_at": end_at},
                "stats": stats,
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


# ── schedule commands ──


@schedule_app.command("add")
def schedule_add(
    title: str = typer.Argument(..., help="Schedule title."),
    start_at: int = typer.Option(..., "--from", "-f", help="Unix epoch start timestamp."),
    end_at: int = typer.Option(..., "--to", "-t", help="Unix epoch end timestamp."),
    description: str | None = typer.Option(None, "--description", "-m", help="Optional details."),
    location: str | None = typer.Option(None, "--location", "-l", help="Optional location."),
    category: str | None = typer.Option(None, "--category", "-c", help="Optional category."),
) -> None:
    """Add a schedule item."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_create(
            title=title, start_at=start_at, end_at=end_at,
            description=description, location=location, category=category,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedule = service.create(
                ScheduleDraft(
                    title=title,
                    start_at=start_at,
                    end_at=end_at,
                    timezone=context.settings.timezone,
                    description=description,
                    location=location,
                    category=category,
                )
            )
            uow.session.flush()
            _echo_json({"ok": True, "schedule": schedule_to_dict(schedule)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("list")
def schedule_list(
    start_at: int | None = typer.Option(
        None,
        "--from",
        "-f",
        help="Unix epoch range start in seconds. Defaults to current time.",
    ),
    end_at: int | None = typer.Option(
        None,
        "--to",
        "-t",
        help="Unix epoch range end in seconds. Defaults to --from + 86400.",
    ),
) -> None:
    """List schedules overlapping an epoch range."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_list(start_at=start_at, end_at=end_at), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        resolved_start_at = start_at if start_at is not None else context.clock.now_epoch()
        resolved_end_at = end_at if end_at is not None else resolved_start_at + 86_400
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedules = service.list_between(resolved_start_at, resolved_end_at)

        _echo_json(
            {
                "ok": True,
                "range": {"start_at": resolved_start_at, "end_at": resolved_end_at},
                "count": len(schedules),
                "schedules": [schedule_to_dict(schedule) for schedule in schedules],
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("search")
def schedule_search(
    pattern: str = typer.Argument(..., help="Regular expression matched against schedule text."),
    start_at: int | None = typer.Option(
        None,
        "--from",
        "-f",
        help="Optional Unix epoch range start in seconds.",
    ),
    end_at: int | None = typer.Option(
        None,
        "--to",
        "-t",
        help="Optional Unix epoch range end in seconds.",
    ),
    ignore_case: bool = typer.Option(
        False,
        "--ignore-case",
        help="Run regex search without case sensitivity.",
    ),
) -> None:
    """Search schedules with a regular expression."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_search(
            pattern=pattern, start_at=start_at, end_at=end_at, ignore_case=ignore_case,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedules = service.search(
                pattern,
                start_at=start_at,
                end_at=end_at,
                case_sensitive=not ignore_case,
            )

        _echo_json(
            {
                "ok": True,
                "pattern": pattern,
                "case_sensitive": not ignore_case,
                "range": {"start_at": start_at, "end_at": end_at},
                "count": len(schedules),
                "schedules": [schedule_to_dict(schedule) for schedule in schedules],
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("show")
def schedule_show(schedule_id: int = typer.Argument(..., help="Schedule id.")) -> None:
    """Show a schedule by id."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_get(schedule_id), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedule = service.show(schedule_id)
            _echo_json({"ok": True, "schedule": schedule_to_dict(schedule)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("update")
def schedule_update(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
    title: str | None = typer.Option(None, "--title", help="New title."),
    start_at: int | None = typer.Option(None, "--from", "-f", help="New Unix epoch start."),
    end_at: int | None = typer.Option(None, "--to", "-t", help="New Unix epoch end."),
    description: str | None = typer.Option(None, "--description", "-m", help="New details."),
    location: str | None = typer.Option(None, "--location", "-l", help="New location."),
    category: str | None = typer.Option(None, "--category", "-c", help="New category."),
) -> None:
    """Update mutable schedule fields."""

    settings = load_cli_settings()
    if settings.server_url:
        fields: dict[str, object] = {}
        if title is not None:
            fields["title"] = title
        if start_at is not None:
            fields["start_at"] = start_at
        if end_at is not None:
            fields["end_at"] = end_at
        if description is not None:
            fields["description"] = description
        if location is not None:
            fields["location"] = location
        if category is not None:
            fields["category"] = category
        _run_http(lambda client: client.schedule_update(schedule_id, **fields), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedule = service.update(
                schedule_id,
                ScheduleUpdate(
                    title=title,
                    start_at=start_at,
                    end_at=end_at,
                    description=description,
                    location=location,
                    category=category,
                ),
            )
            uow.session.flush()
            _echo_json({"ok": True, "schedule": schedule_to_dict(schedule)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("remove")
def schedule_remove(
    targets: Annotated[list[int], typer.Argument(help="Schedule id target(s).")],
) -> None:
    """Remove one or more schedules by id."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_remove(_unique_targets(targets)), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    with UnitOfWork(context.database) as uow:
        service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
        results = [
            _schedule_target_result(
                target,
                lambda current: service.remove(current),
            )
            for target in _unique_targets(targets)
        ]

    _echo_json({"ok": all(result["ok"] for result in results), "results": results})


@schedule_app.command("conflicts")
def schedule_conflicts(
    start_at: int = typer.Option(..., "--from", "-f", help="Unix epoch start timestamp."),
    end_at: int = typer.Option(..., "--to", "-t", help="Unix epoch end timestamp."),
    exclude_id: int | None = typer.Option(None, "--exclude-id", help="Schedule id to ignore."),
) -> None:
    """Check schedule conflicts without creating an item."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_conflicts(
            start_at=start_at, end_at=end_at, exclude_id=exclude_id,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            conflicts = service.conflicts(start_at, end_at, exclude_id=exclude_id)

        _echo_json(
            {
                "ok": True,
                "range": {"start_at": start_at, "end_at": end_at},
                "exclude_id": exclude_id,
                "conflict": bool(conflicts),
                "count": len(conflicts),
                "schedules": [schedule_to_dict(schedule) for schedule in conflicts],
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


@schedule_app.command("stats")
def schedule_stats(
    start_at: int | None = typer.Option(
        None,
        "--from",
        "-f",
        help="Optional Unix epoch range start in seconds.",
    ),
    end_at: int | None = typer.Option(
        None,
        "--to",
        "-t",
        help="Optional Unix epoch range end in seconds.",
    ),
) -> None:
    """Return schedule statistics."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_stats(start_at=start_at, end_at=end_at), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            stats = service.stats(start_at=start_at, end_at=end_at)

        _echo_json(
            {
                "ok": True,
                "range": {"start_at": start_at, "end_at": end_at},
                "stats": stats,
            }
        )
    except AMToDoError as exc:
        _exit_with_error(exc)


# ── user commands ──


@user_app.command("me")
def user_me() -> None:
    """Show the current authenticated user's information."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_me(), settings)


@user_app.command("create")
def user_create(name: str = typer.Argument(..., help="User name.")) -> None:
    """Create a new user with a generated access token."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_create(name), settings)


@user_app.command("list")
def user_list() -> None:
    """List all registered users."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_list(), settings)


@user_app.command("delete")
def user_delete(user_id: int = typer.Argument(..., help="User id.")) -> None:
    """Delete a user by id."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_delete(user_id), settings)


@user_app.command("update")
def user_update(
    user_id: int = typer.Argument(..., help="User id."),
    name: str = typer.Option(..., "--name", "-n", help="New user name."),
) -> None:
    """Update a user's name."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_update(user_id, name), settings)


@user_app.command("regen-token")
def user_regen_token(user_id: int = typer.Argument(..., help="User id.")) -> None:
    """Regenerate a user's access token."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_regenerate_token(user_id), settings)


# ── helpers ──


def _run_http(operation: Callable, settings) -> None:
    """Execute an HTTP client operation and print the JSON result."""
    from client.http import AMTodoClient

    client = AMTodoClient(settings)
    try:
        result = operation(client)
        _echo_json(result)
        if isinstance(result, dict) and result.get("ok") is False:
            raise typer.Exit(1)
    finally:
        client.close()


def _exit_with_error(exc: AMToDoError) -> None:
    _echo_json(
        {
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    )
    raise typer.Exit(1) from exc


def _completion_filter(open_only: bool, completed_only: bool) -> bool | None:
    if open_only and completed_only:
        raise ValidationError("--open and --completed cannot be used together")
    if open_only:
        return False
    if completed_only:
        return True
    return None


def _unique_targets(targets: list[int]) -> list[int]:
    return list(dict.fromkeys(targets))


def _target_result(
    target: int,
    operation: Callable[[int], Todo],
    timezone: str,
) -> dict[str, object]:
    try:
        todo = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, "todo": todo_to_dict(todo, timezone)}


def _schedule_target_result(
    target: int,
    operation: Callable[[int], Schedule],
) -> dict[str, object]:
    try:
        schedule = operation(target)
    except AMToDoError as exc:
        return {
            "target": target,
            "ok": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    return {"target": target, "ok": True, "schedule": schedule_to_dict(schedule)}


def _echo_json(payload: dict[str, object]) -> None:
    typer.echo(json.dumps(payload, ensure_ascii=False, sort_keys=True))


@app.command("gen-keys")
def gen_keys() -> None:
    """Generate a P-256 key pair for request encryption."""
    from amtodo_crypto import generate_keypair

    root = amtodo_root()
    keys_dir = root / "config" / "keys"
    keys_dir.mkdir(parents=True, exist_ok=True)

    private_pem, public_pem = generate_keypair()
    (keys_dir / "server_private.pem").write_bytes(private_pem)
    (keys_dir / "server_public.pem").write_bytes(public_pem)

    _echo_json({
        "ok": True,
        "private_key": str(keys_dir / "server_private.pem"),
        "public_key": str(keys_dir / "server_public.pem"),
        "message": (
            "Keep the private key on the server. Distribute the public key to clients. "
            "Algorithm: P-256 + AES-256-GCM."
        ),
    })


app.add_typer(todo_app, name="todo", help="Manage ToDo items.")
app.add_typer(schedule_app, name="schedule", help="Manage schedule items.")
app.add_typer(user_app, name="user", help="Manage users (admin).")


def main() -> None:
    """Run the command-line application."""

    app()
