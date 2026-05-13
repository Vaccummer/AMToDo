---
name: amtodo-todo
description: Operate AMToDo through the project CLI. Use when an agent needs to manage ToDos, schedules, users, or check server health. The CLI is designed for AI agents and returns JSON for all operations.
---

# AMToDo CLI

Use the AMToDo CLI from the repository root:

```powershell
uv run amtodo <command>
```

All commands return JSON. Prefer parsing the JSON response instead of relying on human-readable text.

## Server Mode

When a `server_url` is configured in `config/cli.toml`, the CLI sends HTTP requests to the AMToDo server instead of using a local database. The same commands work in both modes. Check the server status first:

```powershell
uv run amtodo health
```

## Agent Guide

Retrieve a machine-readable description of all API endpoints (server mode only):

```powershell
uv run amtodo agent-guide
```

## Time Values

Use Unix epoch timestamps in seconds.

- `todo add --date` accepts an epoch timestamp.
- `todo list --from --to`, `todo search --from --to`, and `todo stats --from --to` accept optional epoch bounds.
- `schedule add --from --to` requires epoch bounds.
- Ranges are half-open: `from <= due_at < to`.
- For `todo search` and `todo stats`, omitted bounds mean unbounded.
- For `todo list`, omitted `--from` defaults to current epoch and omitted `--to` defaults to `from + 86400`.
- For `schedule list`, omitted `--from` defaults to current epoch and omitted `--to` defaults to `from + 86400`.

## ToDo Commands

Add a task:

```powershell
uv run amtodo todo add "Write project plan" --date 1778493600 --priority 2 --tag planning
```

List tasks in an epoch range:

```powershell
uv run amtodo todo list --from 1778428800 --to 1778688000
uv run amtodo todo list --from 1778428800 --to 1778688000 --open
uv run amtodo todo list --from 1778428800 --to 1778688000 --completed
```

Search tasks with a regular expression matched against title, description, and tag:

```powershell
uv run amtodo todo search "project|plan" --from 1778428800 --to 1778688000
uv run amtodo todo search "project" --ignore-case
uv run amtodo todo search "项目|课表"
```

Inspect or update a task:

```powershell
uv run amtodo todo show 1
uv run amtodo todo update 1 --title "Updated project plan" --date 1778497200 --priority 3 --tag work
```

Complete, reopen, or remove one or more tasks. Targets are deduplicated by the CLI:

```powershell
uv run amtodo todo done 1 2 2 999
uv run amtodo todo reopen 1 2
uv run amtodo todo remove 1 2 2 999
```

Summarize tasks:

```powershell
uv run amtodo todo stats --from 1778428800 --to 1778688000
```

## Schedule Commands

Add a schedule item:

```powershell
uv run amtodo schedule add "Team meeting" --from 1778493600 --to 1778497200 --category meeting --location "Room 3"
```

List schedules overlapping a time range:

```powershell
uv run amtodo schedule list --from 1778428800 --to 1778688000
```

Search schedules with a regular expression:

```powershell
uv run amtodo schedule search "meeting" --from 1778428800 --to 1778688000
uv run amtodo schedule search "会议" --ignore-case
```

Check for conflicts before creating a schedule:

```powershell
uv run amtodo schedule conflicts --from 1778493600 --to 1778497200
uv run amtodo schedule conflicts --from 1778493600 --to 1778497200 --exclude-id 1
```

Inspect or update a schedule:

```powershell
uv run amtodo schedule show 1
uv run amtodo schedule update 1 --title "Updated meeting" --from 1778494000 --to 1778497600
```

Remove schedules:

```powershell
uv run amtodo schedule remove 1 2 999
```

Summarize schedules:

```powershell
uv run amtodo schedule stats --from 1778428800 --to 1778688000
```

## User Commands (Admin)

User management requires an admin token configured via `config/cli.toml` or `config/server.toml`. All user commands operate through the server (server mode only).

Create a user (returns an access token):

```powershell
uv run amtodo user create "alice"
```

List all users:

```powershell
uv run amtodo user list
```

Update a user's name:

```powershell
uv run amtodo user update 1 --name "alice-new"
```

Delete a user:

```powershell
uv run amtodo user delete 1
```

Regenerate a user's access token (old token becomes invalid):

```powershell
uv run amtodo user regen-token 1
```

## JSON Contract

Successful single-item operations return:

```json
{"ok": true, "todo": {"id": 1, "title": "Task", "due_at": 1778493600}}
```

Bulk operations return one result per unique target. Overall `ok` is false if any target fails:

```json
{
  "ok": false,
  "results": [
    {"target": 1, "ok": true, "todo": {"id": 1}},
    {"target": 999, "ok": false, "error": {"type": "NotFoundError", "message": "todo #999 was not found"}}
  ]
}
```

Query operations return `count` and a list of items. Status filters use `--open` or `--completed`; do not pass both.

Errors return JSON and a non-zero exit code:

```json
{"ok": false, "error": {"type": "ValidationError", "message": "start_at must be earlier than end_at"}}
```

## Agent Guidelines

- Run commands from the AMToDo repository root.
- Treat `id` as the stable target for `show`, `update`, `done`, `reopen`, and `remove`.
- Use `search` before update/remove when the target id is unknown.
- Prefer explicit `--from` and `--to` for deterministic list/search/stats calls.
- Preserve JSON output in summaries when the caller needs exact ids or errors.
- Use `schedule conflicts` to check for overlaps before creating a schedule.
- User management commands require the `admin_token` in config; they only work in server mode.
