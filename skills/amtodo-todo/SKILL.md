---
name: amtodo-todo
description: Operate AMToDo ToDo items through the project CLI. Use when an agent needs to add, list, search, inspect, update, complete, reopen, remove, or summarize ToDo tasks in this repository. The CLI is designed for AI agents and returns JSON for all ToDo operations.
---

# AMToDo ToDo

Use the AMToDo CLI from the repository root:

```powershell
uv run amtodo todo <command>
```

All ToDo commands return JSON. Prefer parsing the JSON response instead of relying on human-readable text.

## Time Values

Use Unix epoch timestamps in seconds.

- `todo add --date` accepts an epoch timestamp and defaults to the current time.
- `todo list --from --to`, `todo search --from --to`, and `todo stats --from --to` accept optional epoch bounds.
- Ranges are half-open: `from <= due_at < to`.
- For `todo search` and `todo stats`, omitted bounds mean unbounded.
- For `todo list`, omitted `--from` defaults to current epoch and omitted `--to` defaults to `from + 86400`.

## Core Commands

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

## JSON Contract

Successful single-task operations return:

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

Query operations return `count` and `todos`. Status filters use `--open` or `--completed`; do not pass both.

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
