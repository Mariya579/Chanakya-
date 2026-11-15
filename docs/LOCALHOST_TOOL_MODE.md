# Localhost tool mode (`npm run dev`)

Runs the web UI at `http://localhost:5173` with the same tool execution the installed exe has.
`npm run dev:plain` is the old UI + API only mode (no desktop tools). `npm run dev:tools` is an alias of `npm run dev`.

```powershell
npm install
npm run dev           # tool host + backend + Vite, one terminal
```

Open `http://localhost:5173` (not the 127.0.0.1 form of another port), sign in, use the Windows Agent model as usual.

## What runs where

| Piece                       | exe                                  | `dev:tools`                                           |
| --------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Tool router/ledger/gate     | `electron/ipc/tool.ipc.js`           | `frontend/dev-host/runtime.js` (same `frontend/tools`) |
| UI → tools                  | preload `window.toolEngine` over IPC | `services/devToolBridge.js` over loopback HTTP        |
| Backend → tools (Windows Agent) | `toolBridgeServer.js`            | same file, started by `dev-host/index.js`             |
| Caller proof                | `requireTrustedSender`               | Host + Origin allow-list + dev header + backend-verified session token |
| State directory             | Electron `userData`                  | `%APPDATA%\Chanakya AI Dev` (`CHANAKYA_USER_DATA_DIR` overrides) |

Approvals, permission levels, danger classification, audit and idempotency are the shared code, unchanged.

## Works in localhost mode

Windows Agent chat route, app discovery/launch/UI automation, browser automation, PowerShell/CMD/file/process/services/registry/hardware/network tools, confirmations and progress, per-app permissions, repair **diagnostics**, workspace folder picker (Windows dialog).

## Does not work here (by design)

- **Windows Repair "start spooler"** – the protected runner only executes from a Program Files install with admin-only ACLs. Dev is fail-closed (`PROTECTED_INSTALL_REQUIRED`). Use the installed exe.
- **Protected software installs** – the plan key needs Electron `safeStorage` (DPAPI); here it is `null`. Offline-installer pickers return `NOT_AVAILABLE_IN_BROWSER`.
- **Electron-only UI** – window modes/bubble, wake word, clipboard watcher, global shortcut, native notifications, TTS via Windows engine. `window.electronAPI` is intentionally not defined.

## Security model

The tool host binds `127.0.0.1` only and refuses a request unless all hold: Host is loopback on its exact port; Origin is `http://localhost:<vite>` or `http://127.0.0.1:<vite>`; header `X-Chanakya-Dev-Tools: 1` is present (forces a CORS preflight); and the bearer session token is accepted by the backend's `/auth/me` on that request. Vite runs with `--strictPort` so the allowed origin cannot silently change. `frontend/dev-host` and its tests are not in the electron-builder `files` list, so they never ship in the exe.

Treat this as a developer mode: any local page you open on the allowed origin while signed in can request tools (still subject to the confirmation gate). Do not expose ports 3001/3002/5173 beyond loopback.

## Environment

`CHANAKYA_DEV_TOOLS_PORT` (3002), `CHANAKYA_DEV_VITE_PORT` (5173), `CHANAKYA_DEV_API_URL` (`http://127.0.0.1:3001`), `CHANAKYA_USER_DATA_DIR`.
