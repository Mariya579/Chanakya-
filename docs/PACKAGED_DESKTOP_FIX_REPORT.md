# Packaged desktop-tool availability fix

## Root cause and pre-edit findings

A. The quoted message was emitted at `backend/src/routes/chat.js:169` before this change (now line 170). It is the safe fallback when a recognized computer request has no matching advertised tool and no execution evidence. The literal safety message and this condition remain intact.

B. `open calculator` selects tool `app`, action `openApp`, params `{query:"calculator"}`. The registry ID is `app.openApp`; the renderer's function schema ID is `app_openApp`. Those are the intentional two transport representations, not a naming mismatch. `desktop` and `uiAutomation` remain separate canonical services for generic UI and specific UI operations.

C. A successful router registers `file, powershell, cmd, services, registry, hardware, process, network, app, uiAutomation, browser, inspector, desktop`; production also registers `windowsRepair`. However, production initialization was not reaching the completed registry.

D. DEV originally resolved `E:\chatbot\frontend\tools\apps\GenericUI.ps1`.

E. The old packaged runtime resolved `E:\chatbot\frontend\release-security\win-unpacked\resources\app\tools\apps\GenericUI.ps1`. Both old DEV and packaged helpers existed. Packaging had `asar:false`, so archive execution was not the original failure.

F. `frontend/tools/ToolEngineRouter.js:99` referenced `path.join` while constructing BrowserAutomationService, but the module did not import `node:path`. Electron always passes `appOptions.directory`; ordinary unit tests usually did not. That conditional expression therefore threw `ReferenceError: path is not defined` only in the production-shaped constructor path. Reproducing from an ordinary `.mjs` file against the actual packaged source confirmed the same stack. No helper or permission denial caused this particular failure.

## End-to-end failure and correction

1. `ComputerTaskPolicy` admits the request as `app.openApp`; TaskRouter/OrchestratorPlanner preserve that action in agent mode. Chat uses the same deterministic admission directly, without an LLM planning round trip.
2. Renderer calls `window.toolEngine.getTools()` before sending `/api/chat`.
3. Electron authenticates the sender, then initializes the ledger/router with its user-data registry directory.
4. The missing import aborted construction at browser-service registration. Startup's internal bridge catch allowed chat to start; later IPC tool discovery failed too.
5. Renderer caught discovery failure and retained `tools: []`.
6. Backend's exact availability condition found no `app_openApp` schema and returned the unchanged safety message. The executor was never reached.
7. Importing `node:path` restores legitimate registration. The request now goes through schema discovery, authenticated IPC, ExecutionLedger, ToolRegistry/permission checks, AppResolver/AppDiscovery, ProcessService activation, and window inspection.

## Changes

- Added the missing `node:path` import to ToolEngineRouter.
- Added `DesktopRuntime.js`: code-owned helper allowlist and DEV/packaged path resolution. Packaged scripts now resolve from `process.resourcesPath/desktop-control`; no model or tool parameter can override those paths.
- Added `DesktopCapabilityDiagnostics.js`: checks registration, UI Automation service, executor, discovery, PowerShell and all six helper files. Missing resources remove desktop capabilities from advertised tools and cause direct proposals to fail `CAPABILITY_NOT_AVAILABLE` through the existing permission policy.
- Added Electron readiness/status wiring. Registration and file checks finish before the internal bridge or IPC handles automation. Discovery refresh remains lazy/coalesced and is awaited by app resolution. Initialization does not set availability true unconditionally.
- Added `getDesktopStatus()` returning boolean readiness/reason codes to the trusted renderer, without filesystem paths.
- Added debug-only startup JSON and PASS/FAIL lines using `CHANAKYA_DEBUG_DESKTOP=1`. The JSON includes exactly the requested runtime, canonical requested tool, registered IDs, executable/helper paths and existence fields. It does not include request text, tokens, input values, page contents or user documents.
- Added a precise debug-only tool-selection projection to chat and rejection of malformed tool-map/error envelopes in the renderer schema converter.
- Configured Electron `extraResources` to ship `GenericUI.ps1`, `DesktopUI.ps1`, `DiscoverApps.ps1`, `ActivateApp.ps1`, `InteractWithApp.ps1`, and `OpenTargetUI.ps1` in `resources/desktop-control`. UIA uses Windows' framework assemblies; these desktop actions have no separate project-owned native helper binary. Existing repair helper validation remains intact.
- Updated package validation to check source integrity and all desktop resources.

No arbitrary shell capability, model-generated PowerShell, ConfirmationGate bypass, authentication bypass or unconditional readiness was added. No Git history/configuration operation was performed.

## Verification

- Pre-fix packaged reproduction: `ReferenceError: path is not defined` at packaged ToolEngineRouter.js:99.
- Constructor regression with Electron-shaped `appOptions.directory`: passed.
- Packaged resource simulation: passed.
- Missing helper simulation: capability absent, direct execution denied, no launch: passed.
- DEV real Calculator launch and window verification: passed.
- Full automated regression: 418 passed, zero failed, seven optional live tests skipped (425 total).
- Fresh packaged output built with Electron Builder, including the actual `Chanakya AI.exe`; frontend production build passed.
- Package validator: 23 security files match source; external desktop helpers match; clean output contains no user storage.
- Actual fresh packaged EXE: `app.isPackaged === true`; real renderer registration/login with an isolated test database; actual chat input `open calculator`; `app_openApp` advertised; permission ALLOW; Calculator success displayed; correct window verified; zero renderer errors.
- Actual original EXE after runtime update: the same end-to-end acceptance passed.
- Actual packaged negative test: temporarily renamed GenericUI.ps1, observed `ready:false` and `GENERIC_UI_SCRIPT_MISSING`, and received the exact original safety message through chat. Restored the file in `finally`; package integrity passed afterward.
- No Vite or development backend served these packaged tests. The only backend used was the child started by the packaged EXE. Playwright was an external test driver, not a development server.

## Updated artifacts and data preservation

Original executable path, now fixed:
`E:\chatbot\frontend\release-security\win-unpacked\Chanakya AI.exe`

Separate clean packaged build:
`E:\chatbot\frontend\release-desktop\win-unpacked\Chanakya AI.exe`

The original output received only the tested runtime resources, frontend build, and chat diagnostic update. Its five existing backend storage files were hashed before and after the update and were unchanged. Original runtime files were backed up under `outputs/desktop-runtime-backup-20260925-193048`. The pre-existing NSIS installer was not replaced; the validated outputs are packaged application EXEs, not a newly generated installer.

Evidence:

- outputs/desktop-packaged-before-result.txt
- outputs/desktop-runtime-tests.txt
- outputs/desktop-runtime-regression.txt
- outputs/desktop-packaged-acceptance.txt
- outputs/desktop-original-exe-acceptance.txt
- outputs/desktop-package-integrity.txt
- outputs/desktop-installed-update.json

Regression entrypoints:
`frontend/tools/tests/desktopRuntime.test.js`
`frontend/scripts/test-desktop-package.mjs`
