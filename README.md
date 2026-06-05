# AMToDo

AMToDo is a personal task, schedule, notification, and attachment manager. The
project contains a Python FastAPI backend, a desktop Electron UI, a Capacitor
mobile UI, and a JSON-oriented CLI for automation.

## Features

- Todo and schedule management with search, batch operations, history, and trash.
- User-scoped data and bearer-token authentication.
- Desktop and mobile settings for server URL, access token, notifications, and UI preferences.
- Real-time UI updates and notification delivery over WebSocket.
- Large attachment upload/download support with resumable desktop downloads.
- Local attachment cache management for desktop, mobile, and CLI flows.
- Reverse-proxy support for HTTPS/WSS deployments.

## Project Layout

```text
.
|-- src/                 Python backend, services, models, API routes, CLI
|-- config/              Runtime configuration templates
|-- frontend/            React, Vite, Electron, and Capacitor frontend
|-- nginx/               Reverse proxy template
|-- scripts/             One-off maintenance scripts
```

## Requirements

- Python 3.12+
- uv
- Node.js 20+ and npm
- Java/JDK and Android SDK only when building Android packages

## Configuration

AMToDo reads runtime files relative to `AMTODO_HOME`. If the environment
variable is not set, the default is `~/.amtodo`.

```powershell
$env:AMTODO_HOME = "D:\CodeLib\Python\AMToDo"
```

Before running a real deployment, edit these files:

- `$AMTODO_HOME/server/config.toml`: backend listener, database path, admin token, attachment root, proxy, CORS, and security headers.
- `$AMTODO_HOME/ui/config.toml`: desktop UI server URL, access token, language, timezone, and optional local attachment download folder.
- `$AMTODO_HOME/cli/config.toml`: CLI server URL, user token, and admin token.

Do not commit real access tokens or admin tokens. If a token has ever been
committed, rotate it before publishing or deploying.

## Backend

Install dependencies:

```powershell
uv sync
```

Run the server:

```powershell
uv run amtodo-server
```

The default API base is:

```text
http://127.0.0.1:8000/api/v1
```

The unified UI WebSocket endpoint is:

```text
ws://127.0.0.1:8000/api/v1/ws
```

When deploying behind HTTPS, keep the backend on a local HTTP listener and put
TLS at the reverse proxy. See `nginx/amtodo.reverse-proxy.conf.template`.

## Users And Tokens

Set a strong `admin_token` in `$AMTODO_HOME/server/config.toml`, start the backend, then use
the CLI to create users:

```powershell
uv run amtodo admin create "Alice"
uv run amtodo admin list
uv run amtodo admin regen-token 1
```

Use the returned user `access_token` in the desktop or mobile settings page.

## Desktop UI

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Run the Electron development shell:

```powershell
npm run dev
```

Build the renderer:

```powershell
npm run build
```

Run the production renderer in Electron:

```powershell
npm run start
```

The current repository builds the renderer and runs Electron directly. A
packaged installer target is not yet defined in `frontend/package.json`.

## Mobile UI

Build the mobile web assets:

```powershell
cd frontend
npm run build:mobile
```

Sync Android assets:

```powershell
npm run cap:sync
```

Build an Android debug APK:

```powershell
npm run build:android
```

Confirm `frontend/capacitor.config.ts` uses the final application id before a
store release.

## CLI

The CLI returns JSON and is suitable for scripts or agent workflows.

```powershell
uv run amtodo --help
uv run amtodo health
uv run amtodo todo add "Write release notes" --priority 2
uv run amtodo todo list
uv run amtodo schedule add "Planning" --from 1778461200 --to 1778466600
uv run amtodo trash list
```

## Validation

Backend tests:

```powershell
uv run pytest
```

Frontend type-check and production renderer build:

```powershell
cd frontend
npm run build
```

Lint:

```powershell
uv run ruff check .
```

The current lint configuration is stricter than parts of the existing codebase.
Treat lint failures as release cleanup work unless the project policy is updated
to ignore generated migrations, tests, or legacy style debt.

## Release Checklist

- Rotate any credentials that have been committed or shared.
- Replace `CHANGE_ME_BEFORE_RELEASE` in `$AMTODO_HOME/server/config.toml`.
- Confirm committed config templates and local UI/CLI config files do not contain real secrets.
- Decide the final Android `appId` in `frontend/capacitor.config.ts`.
- Run `uv run pytest`.
- Run `npm run build` in `frontend/`.
- Build and manually smoke-test desktop login, realtime updates, notifications, attachment upload/download/resume, trash restore/purge, and cache clearing.
- For public deployments, configure HTTPS/WSS reverse proxy, CORS origins, trusted proxy IPs, upload size limits, and proxy timeouts.
- Keep `db/`, `log/`, local caches, private keys, and generated build outputs out of source control.

## Security Notes

- Authenticated REST endpoints use `Authorization: Bearer <access_token>`.
- Admin endpoints require `Authorization: Bearer <admin_token>`.
- User WebSocket auth uses the `amtodo.v1` subprotocol plus bearer token.
- Avoid logging request query strings on attachment upload/download routes because short-lived transfer tokens may appear there.
- The frontend build does not embed UI access tokens. Runtime credentials should be entered through settings or provided by local UI configuration.
