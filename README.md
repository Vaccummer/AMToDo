# AMToDo

A Python desktop scheduling and planning application.

## Development

```powershell
uv run ruff check .
uv run pytest
```

## Entry Points

```powershell
uv run amtodo --help
uv run amtodo-ui
```

## ToDo CLI

```powershell
uv run amtodo todo add "Write project plan" --date 1778493600 --priority 2 --tag planning
uv run amtodo todo list --from 1778428800 --to 1778688000
uv run amtodo todo list --from 1778428800 --to 1778688000 --open
uv run amtodo todo search "project|plan" --from 1778428800 --to 1778688000
uv run amtodo todo search "project" --ignore-case
uv run amtodo todo show 1
uv run amtodo todo update 1 --title "Updated project plan" --priority 3
uv run amtodo todo done 1 2 3
uv run amtodo todo reopen 1
uv run amtodo todo remove 1 2 3
uv run amtodo todo stats --from 1778428800 --to 1778688000
```

ToDo commands emit JSON because the CLI is intended for agent operation.

## Schedule CLI

```powershell
uv run amtodo schedule add "Math class" --from 1778461200 --to 1778466600 --location A101 --category course
uv run amtodo schedule list --from 1778428800 --to 1778688000
uv run amtodo schedule search "math|sync" --from 1778428800 --to 1778688000 --ignore-case
uv run amtodo schedule show 1
uv run amtodo schedule update 1 --title "Linear algebra" --from 1778463000 --to 1778468400
uv run amtodo schedule conflicts --from 1778461200 --to 1778466600
uv run amtodo schedule remove 1 2 2 999
uv run amtodo schedule stats --from 1778428800 --to 1778688000
```
