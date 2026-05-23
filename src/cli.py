"""Command-line entry point."""

from __future__ import annotations

import json
import secrets
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

import typer
from sqlalchemy import delete, select

from client.attachment_cache import AttachmentCache
from clock import Clock, SystemClock
from config import AppSettings, __version__, cli_root, load_cli_settings
from exceptions import AMToDoError, ConflictError, NotFoundError, ValidationError
from models.factory import get_user_tables
from models.user import User
from serialization import attachment_to_dict, schedule_to_dict, todo_to_dict, user_to_dict_with_token
from services import (
    AttachmentDraft,
    AttachmentService,
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
admin_app = typer.Typer(no_args_is_help=True)
cache_app = typer.Typer(no_args_is_help=True)
todo_attachment_app = typer.Typer(no_args_is_help=True, help="Manage ToDo attachments.")
schedule_attachment_app = typer.Typer(no_args_is_help=True, help="Manage schedule attachments.")


@app.callback()
def root(
    version: bool = typer.Option(False, "--version", help="Show the application version."),
) -> None:
    """AMToDo command-line interface."""

    if version:
        typer.echo(__version__)
        raise typer.Exit


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
    extra: str | None = typer.Option(None, "--extra", "-E", help='Extra fields as JSON string, e.g. \'{"key": "value"}\'.'),
) -> None:
    """Add a ToDo item."""

    extra_json = _parse_extra_json(extra)

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
                    extra_fields=extra_json,
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
                resolved_end_at = (
                    end_at if end_at is not None else context.clock.now_epoch() + 86_400
                )
                todos = service.list_between(
                    resolved_start_at,
                    resolved_end_at,
                    completed=completed,
                )

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
    query: str = typer.Argument(..., help="Text matched against ToDo text."),
    use_regex: bool = typer.Option(
        False,
        "--regex",
        help="Treat query as a regular expression.",
    ),
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
        True,
        "--ignore-case",
        help="Search without case sensitivity.",
    ),
    open_only: bool = typer.Option(False, "--open", help="Only search open ToDos."),
    completed_only: bool = typer.Option(False, "--completed", help="Only search completed ToDos."),
) -> None:
    """Search ToDos."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_search(
            query=query,
            use_regex=use_regex,
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
                query,
                use_regex=use_regex,
                ignore_case=ignore_case,
                planned_start_at=planned_start_at,
                planned_end_at=planned_end_at,
                created_start_at=created_start_at,
                created_end_at=created_end_at,
                completed=completed,
            )

        _echo_json(
            {
                "ok": True,
                "query": query,
                "use_regex": use_regex,
                "ignore_case": ignore_case,
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
    extra: str | None = typer.Option(None, "--extra", "-E", help='Extra fields as JSON string, e.g. \'{"key": "value"}\'.'),
) -> None:
    """Update mutable ToDo fields."""

    extra_json: str | None = _parse_extra_json(extra) if extra is not None else None

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
            update_kwargs: dict[str, object] = dict(
                title=title,
                planned_at=planned_at,
                due_at=due_at,
                description=description,
                priority=priority,
                tag=tag,
            )
            if extra_json is not None:
                update_kwargs["extra_fields"] = extra_json
            todo = service.update(
                todo_id,
                TodoUpdate(**update_kwargs),
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


# ── todo attachment commands ──


@todo_attachment_app.command("list")
def todo_attachment_list(todo_id: int = typer.Argument(..., help="ToDo id.")) -> None:
    """List attachment metadata for a ToDo."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        client = AMTodoClient(settings)
        try:
            result = client.todo_attachment_list(todo_id)
            if result.get("ok") and "attachments" in result:
                for a in result["attachments"]:
                    prefix = "[ORPHANED] " if a.get("is_orphaned") else ""
                    print(f"{prefix}{a.get('filename', '')}")
            else:
                _echo_json(result)
                if result.get("ok") is False:
                    raise typer.Exit(1)
        finally:
            client.close()
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            attachments = service.list_for_todo(todo_id)
            for a in attachments:
                d = attachment_to_dict(a, uow.user_id)
                prefix = "[ORPHANED] " if d.get("is_orphaned") else ""
                print(f"{prefix}{d.get('filename', '')}")
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_attachment_app.command("get")
def todo_attachment_get(
    todo_id: int = typer.Argument(..., help="ToDo id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
) -> None:
    """Fetch an attachment into the local decrypted cache."""

    settings = load_cli_settings()
    root = cli_root()
    cache = AttachmentCache(root)
    if settings.server_url:
        from client.http import AMTodoClient

        client = AMTodoClient(settings)
        try:
            result = client.todo_attachment_get(todo_id, attachment_id)
            if result.get("ok") is False:
                _echo_json(result)
                raise typer.Exit(1)
            metadata = result["attachment"]
            if metadata.get("is_orphaned"):
                _exit_with_error(
                    ValidationError(f"附件 #{attachment_id} 文件丢失，元数据已标记为 orphaned。")
                )
            cache_result = cache.get_or_download(
                metadata,
                lambda: client.todo_attachment_download(todo_id, attachment_id),
            )
            _echo_json({"ok": True, "attachment": metadata, "cache": cache_result})
            return
        finally:
            client.close()

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            attachment = service.show(todo_id, attachment_id)
            metadata = attachment_to_dict(attachment, uow.user_id)
            cipher = service.read_cipher(todo_id, attachment_id)
        cache_result = cache.get_or_download(metadata, lambda: cipher)
        _echo_json({"ok": True, "attachment": metadata, "cache": cache_result})
    except (AMToDoError, ValueError) as exc:
        _exit_with_error(ValidationError(str(exc)) if isinstance(exc, ValueError) else exc)


@todo_attachment_app.command("upload")
def todo_attachment_upload(
    todo_id: int = typer.Argument(..., help="ToDo id."),
    file: Annotated[
        Path,
        typer.Argument(
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
            help="Local file path to attach.",
        ),
    ] = ...,
) -> None:
    """Attach a local file to a ToDo."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_attachment_upload(todo_id, file), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            attachment = service.create(
                todo_id,
                AttachmentDraft(filename=file.name, content=file.read_bytes()),
            )
            uow.session.flush()
            _echo_json({"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_attachment_app.command("download")
def todo_attachment_download(
    todo_id: int = typer.Argument(..., help="ToDo id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Output file path. Defaults to the attachment's original filename in the current directory.",
        ),
    ] = None,
) -> None:
    """Download and decrypt an attachment to a local file."""

    settings = load_cli_settings()
    root = cli_root()
    cache = AttachmentCache(root)
    if settings.server_url:
        from client.http import AMTodoClient

        client = AMTodoClient(settings)
        try:
            result = client.todo_attachment_get(todo_id, attachment_id)
            if result.get("ok") is False:
                _echo_json(result)
                raise typer.Exit(1)
            metadata = result["attachment"]
            if metadata.get("is_orphaned"):
                _exit_with_error(
                    ValidationError(f"附件 #{attachment_id} 文件丢失，元数据已标记为 orphaned。")
                )
            cache_result = cache.get_or_download(
                metadata,
                lambda: client.todo_attachment_download(todo_id, attachment_id),
            )
            dest = _resolve_download_path(output, str(metadata["filename"]), cache_result)
            _echo_json({"ok": True, "path": str(dest)})
            return
        finally:
            client.close()

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            attachment = service.show(todo_id, attachment_id)
            metadata = attachment_to_dict(attachment, uow.user_id)
            cipher = service.read_cipher(todo_id, attachment_id)
        cache_result = cache.get_or_download(metadata, lambda: cipher)
        dest = _resolve_download_path(output, str(metadata["filename"]), cache_result)
        _echo_json({"ok": True, "path": str(dest)})
    except (AMToDoError, ValueError) as exc:
        _exit_with_error(ValidationError(str(exc)) if isinstance(exc, ValueError) else exc)


@todo_attachment_app.command("remove")
def todo_attachment_remove(
    todo_id: int = typer.Argument(..., help="ToDo id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
) -> None:
    """Remove an attachment from a ToDo."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.todo_attachment_remove(todo_id, attachment_id), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            attachment = service.remove(todo_id, attachment_id)
            _echo_json({"ok": True, "attachment": attachment_to_dict(attachment, uow.user_id)})
    except AMToDoError as exc:
        _exit_with_error(exc)


@todo_attachment_app.command("remove-orphaned")
def todo_attachment_remove_orphaned(
    todo_id: int = typer.Argument(..., help="ToDo id."),
) -> None:
    """Remove all orphaned attachment metadata for a ToDo."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "todo_attachment_remove_orphaned"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        _run_http(lambda client: client.todo_attachment_remove_orphaned(todo_id), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = _attachment_service(uow, context.clock)
            count = service.remove_orphaned(todo_id)
            _echo_json({"ok": True, "removed": count})
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
    extra: str | None = typer.Option(None, "--extra", "-E", help='Extra fields as JSON string, e.g. \'{"key": "value"}\'.'),
) -> None:
    """Add a schedule item."""

    extra_json = _parse_extra_json(extra)

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
                    extra_fields=extra_json,
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
    query: str = typer.Argument(..., help="Text matched against schedule text."),
    use_regex: bool = typer.Option(
        False,
        "--regex",
        help="Treat query as a regular expression.",
    ),
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
        True,
        "--ignore-case",
        help="Search without case sensitivity.",
    ),
) -> None:
    """Search schedules."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.schedule_search(
            query=query,
            use_regex=use_regex,
            start_at=start_at,
            end_at=end_at,
            ignore_case=ignore_case,
        ), settings)
        return

    context = create_application_context(settings)
    context.database.create_schema()

    try:
        with UnitOfWork(context.database) as uow:
            service = ScheduleService(uow.schedules, context.clock, uow.schedule_model)
            schedules = service.search(
                query,
                use_regex=use_regex,
                ignore_case=ignore_case,
                start_at=start_at,
                end_at=end_at,
            )

        _echo_json(
            {
                "ok": True,
                "query": query,
                "use_regex": use_regex,
                "ignore_case": ignore_case,
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
    extra: str | None = typer.Option(None, "--extra", "-E", help='Extra fields as JSON string, e.g. \'{"key": "value"}\'.'),
) -> None:
    """Update mutable schedule fields."""

    extra_json: str | None = _parse_extra_json(extra) if extra is not None else None

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
            update_kwargs: dict[str, object] = dict(
                title=title,
                start_at=start_at,
                end_at=end_at,
                description=description,
                location=location,
                category=category,
            )
            if extra_json is not None:
                update_kwargs["extra_fields"] = extra_json
            schedule = service.update(
                schedule_id,
                ScheduleUpdate(**update_kwargs),
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


# ── schedule attachment commands ──


@schedule_attachment_app.command("list")
def schedule_attachment_list(schedule_id: int = typer.Argument(..., help="Schedule id.")) -> None:
    """List attachment metadata for a schedule."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_list"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        client = AMTodoClient(settings)
        try:
            result = client.schedule_attachment_list(schedule_id)
            if result.get("ok") and "attachments" in result:
                for a in result["attachments"]:
                    prefix = "[ORPHANED] " if a.get("is_orphaned") else ""
                    print(f"{prefix}{a.get('filename', '')}")
            else:
                _echo_json(result)
                if result.get("ok") is False:
                    raise typer.Exit(1)
        finally:
            client.close()
        return

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


@schedule_attachment_app.command("get")
def schedule_attachment_get(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
) -> None:
    """Fetch a schedule attachment into the local decrypted cache."""

    settings = load_cli_settings()
    root = cli_root()
    cache = AttachmentCache(root)
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_get"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        client = AMTodoClient(settings)
        try:
            result = client.schedule_attachment_get(schedule_id, attachment_id)
            if result.get("ok") is False:
                _echo_json(result)
                raise typer.Exit(1)
            metadata = result["attachment"]
            if metadata.get("is_orphaned"):
                _exit_with_error(
                    ValidationError(f"附件 #{attachment_id} 文件丢失，元数据已标记为 orphaned。")
                )
            cache_result = cache.get_or_download(
                metadata,
                lambda: client.schedule_attachment_download(schedule_id, attachment_id),
            )
            _echo_json({"ok": True, "attachment": metadata, "cache": cache_result})
            return
        finally:
            client.close()

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


@schedule_attachment_app.command("upload")
def schedule_attachment_upload(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
    file: Annotated[
        Path,
        typer.Argument(
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
            help="Local file path to attach.",
        ),
    ] = ...,
) -> None:
    """Attach a local file to a schedule."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_upload"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        _run_http(lambda client: client.schedule_attachment_upload(schedule_id, file), settings)
        return

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


@schedule_attachment_app.command("download")
def schedule_attachment_download(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Output file path. Defaults to the attachment's original filename in the current directory.",
        ),
    ] = None,
) -> None:
    """Download and decrypt a schedule attachment to a local file."""

    settings = load_cli_settings()
    root = cli_root()
    cache = AttachmentCache(root)
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_download"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        client = AMTodoClient(settings)
        try:
            result = client.schedule_attachment_get(schedule_id, attachment_id)
            if result.get("ok") is False:
                _echo_json(result)
                raise typer.Exit(1)
            metadata = result["attachment"]
            if metadata.get("is_orphaned"):
                _exit_with_error(
                    ValidationError(f"附件 #{attachment_id} 文件丢失，元数据已标记为 orphaned。")
                )
            cache_result = cache.get_or_download(
                metadata,
                lambda: client.schedule_attachment_download(schedule_id, attachment_id),
            )
            dest = _resolve_download_path(output, str(metadata["filename"]), cache_result)
            _echo_json({"ok": True, "path": str(dest)})
            return
        finally:
            client.close()

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


@schedule_attachment_app.command("remove")
def schedule_attachment_remove(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
    attachment_id: int = typer.Argument(..., help="Attachment id."),
) -> None:
    """Remove an attachment from a schedule."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_remove"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        _run_http(lambda client: client.schedule_attachment_remove(schedule_id, attachment_id), settings)
        return

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


@schedule_attachment_app.command("remove-orphaned")
def schedule_attachment_remove_orphaned(
    schedule_id: int = typer.Argument(..., help="Schedule id."),
) -> None:
    """Remove all orphaned attachment metadata for a schedule."""

    settings = load_cli_settings()
    if settings.server_url:
        from client.http import AMTodoClient

        if not hasattr(AMTodoClient, "schedule_attachment_remove_orphaned"):
            _exit_with_error(ValidationError("该操作不被当前服务器支持"))
        _run_http(lambda client: client.schedule_attachment_remove_orphaned(schedule_id), settings)
        return

    _exit_with_error(ValidationError("本地模式暂不支持日程附件操作，请配置 server_url。"))


# ── user commands (self-service, access_token) ──


@user_app.command("me")
def user_me() -> None:
    """Show the current authenticated user's information."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_me(), settings)


@user_app.command("update")
def user_update(
    name: str = typer.Option(..., "--name", "-n", help="New user name."),
) -> None:
    """Update your own user name."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_update_self(name), settings)


@user_app.command("regen-token")
def user_regen_token() -> None:
    """Regenerate your own access token."""

    settings = load_cli_settings()
    _run_http(lambda client: client.user_regen_token_self(), settings)


# ── admin commands (manage any user, admin_token) ──


def _fetch_admin_config() -> tuple[str, Path]:
    """Fetch database_url and attachment_root from the server via encrypted HTTP."""
    from client.http import AMTodoClient

    settings = load_cli_settings()
    if not settings.server_url:
        _exit_with_error(ValidationError("server_url is required in config/cli.toml for admin management"))
    if not settings.admin_token:
        _exit_with_error(ValidationError("admin_token is not configured in config/cli.toml"))

    client = AMTodoClient(settings)
    try:
        result = client.admin_config()
        if not result.get("ok"):
            _exit_with_error(ValidationError("failed to fetch server config"))
        config = result["config"]
        return config["database_url"], Path(config["attachment_root"])
    finally:
        client.close()


def _admin_context():
    """Create a database connection using server-provided config."""
    from db.engine import create_database_from_url

    database_url, attachment_root = _fetch_admin_config()
    database = create_database_from_url(database_url)
    return database, attachment_root


def _admin_user_create_direct(name: str) -> dict[str, object]:
    """Create a new user with a generated access token (direct DB)."""
    database, _attachment_root = _admin_context()
    clock = SystemClock()

    with database.session() as session:
        existing = session.execute(
            select(User).where(User.name == name)
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(f"user with name '{name}' already exists")

        token = secrets.token_urlsafe(32)
        user_id_row = session.execute(
            select(User.id).order_by(User.id.desc()).limit(1)
        ).scalar_one_or_none()
        user_id = (user_id_row + 1) if user_id_row is not None else 1

        user = User(
            id=user_id,
            name=name,
            token=token,
            created_at=clock.now_epoch(),
        )
        session.add(user)
        session.commit()

        result = user_to_dict_with_token(user)

    get_user_tables(user_id)
    database.create_schema()

    return {"ok": True, "user": result}


def _admin_user_list_direct() -> dict[str, object]:
    """List all registered users (direct DB)."""
    database, _attachment_root = _admin_context()

    with database.session() as session:
        users = list(
            session.execute(select(User).order_by(User.id)).scalars().all()
        )
        return {
            "ok": True,
            "count": len(users),
            "users": [user_to_dict_with_token(u) for u in users],
        }


def _admin_user_delete_direct(user_id: int) -> dict[str, object]:
    """Delete a user and all owned data (direct DB)."""
    database, attachment_root = _admin_context()

    with database.session() as session:
        user = session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"user {user_id} not found")

        token = user.token
        name = user.name

        (
            todo_model,
            schedule_model,
            setting_model,
            todo_att_model,
            sched_att_model,
            todo_changelog_model,
            schedule_changelog_model,
            _notification_changelog_model,
            _notification_model,
            _notification_mention_model,
        ) = get_user_tables(user_id)

        # Remove attachment files from disk
        for model in (todo_att_model, sched_att_model):
            for att in session.execute(select(model)).scalars():
                file_path = attachment_root / att.storage_path
                if file_path.is_file():
                    file_path.unlink()

        # Remove all rows from per-user tables
        for model in (
            todo_att_model,
            sched_att_model,
            todo_model,
            schedule_model,
            setting_model,
        ):
            session.execute(delete(model))

        session.delete(user)
        session.commit()

    return {"ok": True, "deleted": {"id": user_id, "name": name}}


def _admin_user_update_direct(user_id: int, name: str) -> dict[str, object]:
    """Update a user's name (direct DB)."""
    database, _attachment_root = _admin_context()

    with database.session() as session:
        user = session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"user {user_id} not found")

        existing = session.execute(
            select(User).where(User.name == name, User.id != user_id)
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(f"user with name '{name}' already exists")

        user.name = name
        session.commit()
        return {"ok": True, "user": user_to_dict_with_token(user)}


def _admin_user_regen_token_direct(user_id: int) -> dict[str, object]:
    """Regenerate a user's access token (direct DB)."""
    database, _attachment_root = _admin_context()

    with database.session() as session:
        user = session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"user {user_id} not found")

        new_token = secrets.token_urlsafe(32)
        for _ in range(10):
            existing = session.execute(
                select(User).where(User.token == new_token)
            ).scalar_one_or_none()
            if existing is None:
                break
            new_token = secrets.token_urlsafe(32)
        else:
            raise ValidationError("failed to generate unique token")

        user.token = new_token
        session.commit()
        return {"ok": True, "user": user_to_dict_with_token(user)}


@admin_app.command("create")
def admin_create(name: str = typer.Argument(..., help="User name.")) -> None:
    """Create a new user with a generated access token."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.user_create(name), settings)
        return

    _echo_json(_admin_user_create_direct(name))


@admin_app.command("list")
def admin_list() -> None:
    """List all registered users."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.user_list(), settings)
        return

    _echo_json(_admin_user_list_direct())


@admin_app.command("delete")
def admin_delete(
    user_id: int = typer.Argument(..., help="User id."),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation."),
) -> None:
    """Delete a user and all owned data."""

    if not force:
        typer.echo(f"Are you sure you want to delete user {user_id} and ALL their data?")
        typer.echo("This includes todos, schedules, and attachments. This cannot be undone.")
        confirmed = typer.confirm("Continue?")
        if not confirmed:
            typer.echo("Aborted.")
            raise typer.Exit

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.user_delete(user_id), settings)
        return

    _echo_json(_admin_user_delete_direct(user_id))


@admin_app.command("update")
def admin_update(
    user_id: int = typer.Argument(..., help="User id."),
    name: str = typer.Option(..., "--name", "-n", help="New user name."),
) -> None:
    """Update a user's name."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.user_update(user_id, name), settings)
        return

    _echo_json(_admin_user_update_direct(user_id, name))


@admin_app.command("regen-token")
def admin_regen_token(user_id: int = typer.Argument(..., help="User id.")) -> None:
    """Regenerate a user's access token."""

    settings = load_cli_settings()
    if settings.server_url:
        _run_http(lambda client: client.user_regenerate_token(user_id), settings)
        return

    _echo_json(_admin_user_regen_token_direct(user_id))


# ── cache commands ──


@cache_app.command("attachment-clear")
def attachment_cache_clear() -> None:
    """Clear the local attachment cache."""

    cache = AttachmentCache(cli_root())
    cache.clear()
    _echo_json({"ok": True})


# ── helpers ──


def _parse_extra_json(raw: str | None) -> str:
    """Parse --extra JSON string, return '{}' if None."""
    if raw is None:
        return "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise typer.BadParameter(f"Invalid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise typer.BadParameter("Extra fields must be a JSON object")
    for k, v in parsed.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise typer.BadParameter("All keys and values must be strings")
    return json.dumps(parsed, ensure_ascii=False)


def _run_http(operation: Callable, settings: AppSettings) -> None:
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


def _attachment_service(uow: UnitOfWork, clock: Clock) -> AttachmentService:
    return AttachmentService(
        uow.attachments,
        uow.todos,
        clock,
        uow.attachment_model,
        cli_root(),
        uow.user_id,
    )


def _echo_json(payload: dict[str, object]) -> None:
    typer.echo(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def _resolve_download_path(
    output: Path | None,
    filename: str,
    cache_result: dict[str, object],
) -> Path:
    """Resolve the output path for a downloaded attachment."""
    dest = output or Path.cwd() / filename
    src = Path(str(cache_result["path"]))
    if dest != src:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    return dest.resolve()


@app.command("gen-keys")
def gen_keys(
    output_dir: Annotated[
        Path,
        typer.Argument(
            file_okay=False,
            dir_okay=True,
            writable=True,
            help="Directory to write generated key pair into.",
        ),
    ] = ...,
) -> None:
    """Generate a P-256 key pair for request encryption."""
    from amtodo_crypto import generate_keypair

    keys_dir = output_dir.resolve()
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


@app.command("fingerprint")
def fingerprint(
    public_key_path: Annotated[
        Path,
        typer.Argument(
            exists=True,
            file_okay=True,
            dir_okay=False,
            help="Path to a P-256 public key PEM file.",
        ),
    ] = ...,
) -> None:
    """Compute SHA-256 fingerprint of a P-256 public key (same algorithm as the UI)."""
    import hashlib
    from amtodo_crypto.keys import public_key_spki

    pem_bytes = public_key_path.read_bytes()
    der_bytes = public_key_spki(pem_bytes)
    digest = hashlib.sha256(der_bytes).hexdigest()
    fingerprint_str = f"sha256:{digest}"

    _echo_json({
        "ok": True,
        "fingerprint": fingerprint_str,
        "public_key": str(public_key_path.resolve()),
    })


app.add_typer(todo_app, name="todo", help="Manage ToDo items.")
app.add_typer(schedule_app, name="schedule", help="Manage schedule items.")
app.add_typer(user_app, name="user", help="User self-service (me, update, regen-token).")
app.add_typer(admin_app, name="admin", help="Admin user management (create, list, delete, update, regen-token).")
app.add_typer(cache_app, name="cache", help="Manage local caches.")
todo_app.add_typer(todo_attachment_app, name="attachment")
schedule_app.add_typer(schedule_attachment_app, name="attachment")


def main() -> None:
    """Run the command-line application."""

    app()
