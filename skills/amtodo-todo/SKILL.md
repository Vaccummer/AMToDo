---
name: amtodo-todo
description: Operate AMToDo through the project CLI. Use when Codex needs to manage AMToDo todos, schedules, attachments, trash, users, tokens, server health, or cache state from the command line. The CLI is designed for agents and returns JSON for operations.
---

# AMToDo CLI

Run commands from the AMToDo repository root:

```powershell
uv run amtodo <command>
```

Prefer parsing JSON output. Preserve exact ids and error objects when the user
needs reliable follow-up actions.

## Runtime Setup

The CLI reads `cli/config.toml` under `AMTODO_HOME`.

```powershell
$env:AMTODO_HOME = "D:\CodeLib\Python\AMToDo"
```

Required for remote operation:

```toml
server_url = "http://127.0.0.1:8000"
access_token = "<user token>"
admin_token = "<admin token, only for admin commands>"
```

Do not invent tokens. If auth fails or config has empty tokens, ask the user to
provide/configure the token or use admin commands to create/regenerate one.

## Health And Discovery

```powershell
uv run amtodo health
uv run amtodo agent-guide
uv run amtodo --version
```

Use `health` before user-impacting operations when server reachability is
uncertain. Use `agent-guide` for detailed API shape if CLI output is not enough.

## Time Values

Use Unix epoch timestamps in seconds.

- Todo `--planned-at` is `planned_at` (planned/scheduled date).
- Todo `--date` is `due_at` (deadline/due date), not the normal planned date.
- Schedule `--from` and `--to` are required for create/update time ranges.
- List/search/stat ranges are half-open: `from <= value < to`.
- `schedule list` defaults to `from=now`, `to=from+86400` when omitted.
- Prefer explicit `--from` and `--to` for deterministic results.

When interpreting natural language for todos:

- If the user says "create a todo for tomorrow", "tomorrow's todo", "明天的待办", "下周一提醒我做 X", etc., treat the date as the todo's planned date and set `--planned-at`.
- Leave `--date`/`due_at` empty unless the user explicitly mentions a deadline, due date, "截止", "到期", "deadline", or "due".
- If both planned time and deadline are mentioned, set both: `--planned-at` for when it is planned, `--date` for when it is due.
- If the user gives only a date without a time, use the start of that local day for `--planned-at` unless the user/context indicates another time.
- Use the user's locale/timezone context when converting relative dates like today, tomorrow, this Friday, or next week.

## Todos

Create:

```powershell
# "Tomorrow's todo" -> planned date only; do not set --date unless a deadline is stated.
uv run amtodo todo add "Buy printer paper" --planned-at 1778486400
uv run amtodo todo add "Write release notes" --planned-at 1778400000 --date 1778493600 --priority 2 --tag release -m "Draft changelog"
uv run amtodo todo add "Review build" --extra '{"area":"desktop"}'
```

List/search:

```powershell
uv run amtodo todo list
uv run amtodo todo list --open
uv run amtodo todo list --completed --from 1778428800 --to 1778688000
uv run amtodo todo search "release"
uv run amtodo todo search "release|build" --regex --ignore-case
uv run amtodo todo search "bug" --open --created-from 1778428800
```

Inspect/update:

```powershell
uv run amtodo todo show 1
uv run amtodo todo update 1 --title "Updated title" --planned-at 1778500000 --date 1778586400 --priority 3 --tag work -m "Updated details"
uv run amtodo todo update 1 --extra '{"status":"blocked"}'
```

State and removal:

```powershell
uv run amtodo todo done 1 2 3
uv run amtodo todo reopen 1
uv run amtodo todo remove 1 2
uv run amtodo todo stats --from 1778428800 --to 1778688000
```

`remove` moves items to trash; use trash commands for restore or permanent
delete.

## Notifications

Create/list:

```powershell
uv run amtodo notify add "Stand up" --trigger 1778493600 -m "Daily sync" --extra '{"channel":"desktop"}'
uv run amtodo notify list --from 1778428800 --to 1778688000
```

Inspect/update/remove:

```powershell
uv run amtodo notify show 1
uv run amtodo notify update 1 --title "Updated reminder" --trigger 1778500000 --extra '{"status":"snoozed"}'
uv run amtodo notify remove 1
```

`remove` moves notifications to trash; use trash commands for restore or
permanent delete.

## Schedules

Create/list/search:

```powershell
uv run amtodo schedule add "Planning" --from 1778493600 --to 1778497200 --category meeting --location "Room 3" -m "Release planning"
uv run amtodo schedule list --from 1778428800 --to 1778688000
uv run amtodo schedule search "planning" --regex --ignore-case
```

Conflict check:

```powershell
uv run amtodo schedule conflicts --from 1778493600 --to 1778497200
uv run amtodo schedule conflicts --from 1778493600 --to 1778497200 --exclude-id 1
```

Inspect/update/remove/stats:

```powershell
uv run amtodo schedule show 1
uv run amtodo schedule update 1 --title "Updated meeting" --from 1778494000 --to 1778497600 --location "Room 5"
uv run amtodo schedule remove 1 2
uv run amtodo schedule stats --from 1778428800 --to 1778688000
```

Use `schedule conflicts` before creating or moving schedules when overlap
matters.

## Attachments

Attachment commands are top-level and require `--type todo` or
`--type schedule`.

```powershell
uv run amtodo attachment list 1 --type todo
uv run amtodo attachment upload 1 .\report.pdf --type todo
uv run amtodo attachment get 1 42 --type todo
uv run amtodo attachment download 1 42 --type todo --output .\report.pdf
uv run amtodo attachment rename 1 42 "final-report.pdf" --type todo
uv run amtodo attachment remove 1 42 --type todo
uv run amtodo attachment remove-orphaned 1 --type todo
```

For schedules, change only the type:

```powershell
uv run amtodo attachment list 7 --type schedule
uv run amtodo attachment download 7 15 --type schedule --output .\agenda.pdf
```

`get` fetches into the local CLI cache. `download` writes a user-selected output
file. Use `cache attachment-clear` to clear the local attachment cache:

```powershell
uv run amtodo cache attachment-clear
```

## Trash

Trash entity types are `todo`, `schedule`, and `notification`.

```powershell
uv run amtodo trash list todo
uv run amtodo trash list schedule --query "meeting" --from 1778428800 --to 1778688000
uv run amtodo trash show 1 --type todo
uv run amtodo trash update 1 --type todo --title "Restored title" --priority 2
uv run amtodo trash restore 1 2 --type todo
uv run amtodo trash purge 1 2 --type todo
```

Use `purge` only when the user explicitly wants permanent deletion.

## Users And Tokens

Self-service user commands require `access_token`:

```powershell
uv run amtodo user me
uv run amtodo user update --name "New Name"
uv run amtodo user regen-token
```

`user regen-token` invalidates the old token. Report the new token only when
the user asked for it or needs it to continue.

Admin commands require `admin_token`:

```powershell
uv run amtodo admin create "Alice"
uv run amtodo admin list
uv run amtodo admin update 1 --name "Alice Smith"
uv run amtodo admin regen-token 1
uv run amtodo admin delete 1
```

Admin create and regen-token return access tokens. Handle them as secrets.

## JSON Contract

Single-item success:

```json
{"ok": true, "todo": {"id": 1, "title": "Task"}}
```

Bulk operations return one result per unique target. Overall `ok` may be false
when any target fails:

```json
{
  "ok": false,
  "results": [
    {"target": 1, "ok": true},
    {"target": 999, "ok": false, "error": {"type": "NotFoundError", "message": "todo #999 was not found"}}
  ]
}
```

Errors return JSON and a non-zero exit code:

```json
{"ok": false, "error": {"type": "ValidationError", "message": "start_at must be earlier than end_at"}}
```

## Agent Guidelines

- Run from the repository root unless the user gives another root.
- Use `search` before update/remove when an id is unknown.
- Use explicit date ranges for deterministic list/search/stat output.
- Do not use removed legacy nested attachment commands such as `todo attachment`.
- Treat access tokens and admin tokens as secrets.
- For destructive operations, distinguish trash `remove` from permanent `trash purge`.
- If a command fails due to empty `server_url`, `access_token`, or `admin_token`, report the missing config rather than trying unrelated commands.
