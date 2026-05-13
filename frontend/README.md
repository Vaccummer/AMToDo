# AMToDo Electron Frontend

Human-facing desktop UI for AMToDo. The Python FastAPI server remains the source of truth for data and business rules.

## Development

Install dependencies:

```powershell
cd frontend
npm install
```

Run the Electron/Vite dev shell:

```powershell
npm run dev
```

Build the renderer:

```powershell
npm run build
```

## Backend

The renderer currently expects the AMToDo API at:

```text
http://127.0.0.1:8000
```

The first scaffold only checks `/api/v1/health` without auth. ToDo and Schedule data calls already target the existing REST API and will need a user token configuration flow before they can be used against protected endpoints.

## Window Shell

The Electron shell uses:

- `frame: false`
- `thickFrame: true`
- `roundedCorners: true`
- CSS `app-region: drag` on the title bar
- CSS `app-region: no-drag` on window buttons

This keeps the custom titlebar style while letting Electron/Windows handle native resize behavior.
