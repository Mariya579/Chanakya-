# Chanakya AI desktop remediation — 8 October 2026

The Windows NSIS installer was built offline, validated, and its actual packaged
application was executed on this Windows PC. This is an **unsigned release
candidate**: installation on a clean Windows machine and live installation/repair
acceptance remain unverified. No commit, push, history reset, dependency download,
software installation, or change to an existing user's data was performed.

Installer: `E:\chatbot\frontend\release-desktop-20261008-final\Chanakya AI Setup 1.0.0.exe`

Packaged application tested:
`E:\chatbot\frontend\release-desktop-20261008-final\win-unpacked\Chanakya AI.exe`

Installer size: 296,694,753 bytes. Installer SHA-256:
`0f2a069931878778cf9c4629214854098f3fd7b45ba39c60ae00208d93c19981`.
Both application and installer report `NotSigned` through Windows Authenticode.

## Root causes and implementation by phase

The pre-change audit and implementation order are in
[DESKTOP_REMEDIATION_PLAN.md](/E:/chatbot/docs/DESKTOP_REMEDIATION_PLAN.md).

| Phase                  | Verified root cause or missing control                                                                                                                                                                             | Implemented behavior                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — audit              | Development and installed paths differed; mutable files lived under installed resources; startup treated any port owner as disposable; test commands were absent or used the wrong runtime                         | Audited existing architecture and dirty working tree before changes; saved the matrix; added runnable Node and Electron checks                                                                                                                                                                                                         |
| 1 — uploads            | Chat paperclip/drop immediately indexed global Knowledge; no draft cards or exact message association; unsupported files silently disappeared; no cancellation; nested folders had no workspace enumeration        | Distinct attachment/knowledge/workspace purposes; multi-file cards, progress, cancellation and per-file failures; exact message IDs and metadata; validated signatures/MIME/names/limits; recursive folder hierarchy and access feedback                                                                                               |
| 2 — UI                 | Knowledge and permissions occupied primary navigation; raw tool JSON/repair internals appeared in Chat; a transformed sidebar clipped Settings                                                                     | Primary Workspace navigation; advanced knowledge/permission management; brief tool status and redacted diagnostics; Settings portal and focus handling; accessible composer controls and responsive sidebar                                                                                                                            |
| 3 — document answers   | Retrieval filtered only user, so unrelated conversations shared document context; one unpunctuated paragraph became an unlimited chunk; valid PDFs failed on current Node with Buffer input                        | Authenticated attachment and workspace scopes throughout FTS/table/vector retrieval; bounded 900-character chunks; page/filename references; real PDF parsing with copied Uint8Array; safe Office archive expansion; reindex stages replacements before retiring prior indexes                                                         |
| 4 — models             | Static allowlist rejected installed qwen:latest; one model received the full OS tool catalog; renderer claims did not establish model-route authority                                                              | Local tags/show discovery, per-user General/Windows preferences, capability/context/lifecycle validation and fallback; General has zero OS tools; Windows proposals are signed and bound to user/call/action/parameters/expiry; serial inference and bounded queue; configured keep-alive replaces automatic global unloading          |
| 5 — apps/installations | Generic inventory/fuzzy matching/UIA already existed; network lookup/download lacked contextual approval; approved package identity could change before install                                                    | Preserved generic discovery and ambiguity handling; approval before online lookup/download/install; pinned Winget identity/version/source/hash and revalidation; native offline installer selection, private quarantine, signature/product/hash verification and separate approval; signed proposal replay prevention                  |
| 6 — profile/workspace  | Profile was read-only; optional fields could not be cleared; settings wrote different keys from those read; no persistent workspace model; initial refresh could overwrite typed fields                            | Working validated profile updates and optional-field clearing; legacy settings-key compatibility; per-user SQLite workspaces, root selection and nested enumeration, active selection restoration, index/reindex/pause/remove-index; stale refresh rejection and initial-load controls; originals are preserved                        |
| 7 — EXE/lifecycle      | Port reclaim could kill unrelated programs; packaged resources were not writable; release paths could preserve user databases in an installer or remove recovery storage; health and child lifecycle needed bounds | Owned OS-assigned loopback port shared through minimal preload; writable per-user backend data and copy-only legacy migration; fresh clean release outputs; native dependency and source-byte validation; timeout/disposal on readiness; owned backend/helper/translation cleanup; local-only optional Whisper and local speech voices |
| 8 — verification       | npm test missing; Electron tests failed when invoked under Node; no truthful packaged evidence                                                                                                                     | 71 component tests, 8 real Electron assertions, 16 localhost checks, 23 development Electron checks, 26 actual packaged checks; saved structured results/screenshots and release hashes                                                                                                                                                |

## Architecture and changed files

The repository already contained extensive staged, unstaged, deleted and untracked
changes. These were preserved; the whole Git diff must not be attributed to this
remediation. The principal files touched or added for this work are listed below.

| Area                        | Files                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API/runtime/data            | `backend/src/app.js`, `config.js`, `server.js`, `db/connection.js`, `db/documentMigrations.js`, `lib/portGuard.js`, `lib/chunkText.js`, `middleware/rateLimiter.js`, `services/indictransProcess.js`, `backend/.env.example`                                                                                                                                                                                     |
| Upload, scope and history   | `backend/src/routes/upload.js`, `routes/documents.js`, `routes/chat.js`, `services/documentService.js`, `documentIngestionService.js`, `documentsStore.js`, `imageAttachmentService.js`, `historyService.js`, `vectorService.js`, `docqa/ingest.js`, `retrieve.js`, `structuredStore.js`, `tableParser.js`                                                                                                       |
| Workspace/profile           | `backend/src/routes/workspaces.js`, `services/workspacePaths.js`, `workspaceService.js`, `authService.js`; `frontend/electron/ipc/workspace.ipc.js`; `frontend/src/workspace/WorkspacePanel.jsx`, `profile/ProfileSettings.jsx`, `ProfileDetails.jsx`                                                                                                                                                            |
| Model routing               | `backend/src/services/modelRouter.js`, `modelRuntime.js`, `modelRouteAuthority.js`, `inferenceGate.js`, `ollamaService.js`, `ai/llmClient.js`, `routes/models.js`, `routes/orchestrate.js`, `orchestrator/AstraRunner.js`; `frontend/src/settings/ModelSettings.jsx`                                                                                                                                             |
| Permission/install boundary | `frontend/tools/security/ModelRouteAuthority.js`, `ToolPermissionPolicy.js`, `ToolRegistry.js`, `ExecutionLedger.js`, `ExecutionContext.js`, `ConfirmationGate.js`, `services/WingetService.js`, `WebInstallService.js`; `frontend/electron/ipc/tool.ipc.js`, `toolBridgeServer.js`; `frontend/src/services/chatExecution.js`, `apps/AppPermissionsPanel.jsx`, `settings/OfflineInstallerControls.jsx`           |
| Renderer/transport          | `frontend/src/App.jsx`, `chat/InputArea.jsx`, `ChatArea.jsx`, `MessageList.jsx`, `sidebar/Sidebar.jsx`, `components/MainLayout.jsx`, `Topbar.jsx`, `settings/SettingsModal.jsx`, `DiagnosticLog.jsx`, `stores/useAppStore.js`, `services/api.js`, `transcriber.js`, `speak.js`, `screen/OcrCropModal.jsx`, `widget/FloatingBubble.jsx`, `utils/attachments.js`, `diagnostics.js`, `styles.css`, `vite.config.js` |
| Electron/packaging          | `frontend/electron/main.js`, `preload.cjs`, `managers/BackendManager.js`, `WindowManager.js`, `services/BackendHealth.js`, `ToolActor.js`, `utils/runtimeEndpoint.js`, `runtimeStorage.js`, `redactDiagnostics.js`; `frontend/scripts/prepare-backend.cjs`, `afterPack.cjs`, `build-release.cjs`, `release-output.cjs`, `validate-security-package.cjs`; package scripts, `.gitignore`, `build-exe.cmd`          |
| Verification                | `scripts/run-tests.mjs`, `run-electron-tests.mjs`, `desktop-acceptance.mjs`; backend document/workspace/model/transport/profile/inference/PowerShell tests; frontend attachment/install/route-security/helper/runtime tests; real PDF/PNG/JPEG/WebP fixtures; `docs/verification/*`                                                                                                                              |

Document scope is additive: old rows remain Knowledge; chat attachments are bound
transactionally to the exact user turn and conversation; workspace indexes are
separate from originals. Index removal never removes the selected directory's files.
Image bytes live in a private SQLite BLOB table and are not exposed in normal API
metadata or history. The assistant receives image bytes only after ownership and
conversation checks and only through a discovered vision-capable model.

The existing central permission engine remains authoritative. A renderer string
claiming Windows authority grants nothing; backend-signed proposals are checked in
Electron and bound to one execution identity. Approval remains bound to the same
user, task, route and parameters. Arbitrary model-generated PowerShell remains
blocked. The user interface requests approvals; it does not silently approve them.

Installed data uses `app.getPath("userData")/backend-data/storage`. Development
keeps its existing storage unless APP_DATA_PATH is explicitly set. Migration copies
legacy storage into an empty destination, never merges over current data and never
removes the source. Existing external Ollama/translation services are left alone;
only children started by this app are cleaned up.

## Actual tests and evidence

| Check                                                                                                                                               | Result                                                                                                                    | Evidence                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Node components, real local HTTP/native SQLite/LanceDB, parser/scoping/ownership, queue, installer negative policies, PowerShell stdout/exit/cancel | **71 passed, 0 failed, 0 skipped**                                                                                        | [component-tests.txt](/E:/chatbot/docs/verification/component-tests.txt)                                          |
| Real Electron IPC sender trust and navigation                                                                                                       | **8 passed**                                                                                                              | [electron-tests.txt](/E:/chatbot/docs/verification/electron-tests.txt)                                            |
| Localhost Vite/Edge UI: uploads, profile/model settings, attachment answer, workspace, PDF/DOCX                                                     | **16/16 passed**                                                                                                          | [development-localhost.json](/E:/chatbot/docs/verification/development-localhost.json)                            |
| Development Electron UI, exact history metadata, unrelated port owner, restart, backend exit                                                        | **23/23 passed**                                                                                                          | [development-electron.json](/E:/chatbot/docs/verification/development-electron.json)                              |
| Actual packaged Windows binary: UI/upload/document/workspace/restart/cleanup and real local vision                                                  | **26/26 passed**                                                                                                          | [packaged-acceptance.json](/E:/chatbot/docs/verification/packaged-acceptance.json)                                |
| Both actual installed Qwen routes; Windows test proposed a tool and executed no OS action                                                           | **2/2 passed**                                                                                                            | [local-model-routes.json](/E:/chatbot/docs/verification/local-model-routes.json), explicit audit-agent provenance |
| Actual Windows inventory and names/misspellings                                                                                                     | **8/8 correct-or-clarify decisions**; 459 entries, 254 native eligible entries; some scan sources reported partial errors | [native-inventory.json](/E:/chatbot/docs/verification/native-inventory.json)                                      |
| Packaged source/security byte integrity, mutable storage absent, protected repair bytes                                                             | **Passed: 93 security/source files**                                                                                      | [package-validation.json](/E:/chatbot/docs/verification/package-validation.json)                                  |

Screenshots inspected visually:
[packaged chat](/E:/chatbot/docs/verification/packaged-chat.png) and
[packaged workspace](/E:/chatbot/docs/verification/packaged-workspace.png).
They confirm attachment metadata, readable source references, and workspace controls.

The negative-policy installer tests use controlled test runners to prove no network
or execution occurs before approval and no installation starts after identity/hash
changes. They are not evidence of a real software installation. No software was
installed and no OS repair/system setting was changed during acceptance.

Initial failures were retained in isolated `.qa` artifacts: wrong test runtime,
Settings clipping, workspace field-reset race, screenshot transport timeout, and a
source-formatting mismatch during the first release build. The relevant defects or
test harness problems were corrected and the final checks passed. One Vite run had
a transient dynamic-module load failure during heavy concurrent work; its precise
cause was not reproduced. The later instrumented localhost run passed without an
uncaught renderer error. This observation is not presented as a proven code fix.

## Measurements and practical limits

| Measurement                   | Actual observation                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-text bound before/after  | 12,000 unpunctuated characters previously formed one 12,000-character chunk; now 16 chunks, maximum 900 characters                                                                                                           |
| Development Electron startup  | 3.308 s initially and 3.580 s after restart in the recorded run                                                                                                                                                              |
| Packaged Electron startup     | 20.747 s initially and 5.977 s after restart; this run overlapped installer packaging and is not a clean startup benchmark                                                                                                   |
| Electron working-set snapshot | Development sum about 509 MiB; packaged sum about 829 MiB. Summing process working sets can double-count shared pages; these snapshots exclude a complete host/Ollama memory accounting and are not before/after comparisons |
| Cold General Qwen probe       | qwen:latest: 9.027 s, first token 8.677 s, model load 7.671 s; 4 generated tokens                                                                                                                                            |
| Cold Windows Qwen proposal    | qwen3.5:9b: 53.710 s, model load 19.454 s; 15 generated tokens; zero executed OS tools                                                                                                                                       |
| Actual vision answer          | qwen3.5:9b answered `Blue` through the General route in 104.941 s; zero OS tool calls                                                                                                                                        |
| Native inventory              | 19.913 s; partial path/install-root scan errors surfaced rather than claiming exhaustive discovery                                                                                                                           |

There is no valid pre-remediation startup/inference/memory baseline; no speedup
percentage is claimed. This PC has approximately 23.87 GiB RAM and integrated
Intel UHD 620 graphics. Dedicated/free VRAM was unavailable; WMI's reported adapter
RAM is not treated as a usable VRAM budget. Model disk size is not presented as
runtime RAM/VRAM requirement.

Workspace scans are bounded at 10,000 entries; an index/import request handles at
most 500 files. Chat supports at most 20 attachments, documents at 25 MB, and images
at 10 MB each/25 MB combined with a 20-megapixel dimension bound. Document ingestion
admits two active requests plus eight queued; model inference admits one active
request plus eight queued. Scanned/image-only/encrypted documents can produce an
explicit no-text or unsupported message rather than fabricated extraction.

Remaining acceptance gaps and risks:

- A clean Windows machine/VM was not available. The NSIS installer was built but
  not installed; Program Files ACL/UAC, upgrades/migration of a live legacy install
  and clean-machine native dependencies still need acceptance.
- The build is unsigned. A production signing certificate was not supplied.
- Real software installation, OS repair changes, and end-to-end tasks inside
  third-party applications were not performed. Existing inventory/UIA/verification
  infrastructure remains, but full automation is not promised for every app.
- Access-denied folder feedback is implemented; actual hostile ACL cases need
  manual Windows acceptance. Real junction loops/escapes were tested.
- Hidden launch options and actual stdout/exit/cancellation/shutdown were tested;
  transient console flashing was not independently observed across all Windows
  helpers. Microphone/camera/translation/optional Whisper/3D-avatar device acceptance
  was not completed. Local models and the Python translation runtime are not bundled.
- Web vendor-domain ranking is a heuristic, not proof of vendor ownership.
  Download/install still requires explicit review and signature/identity/hash checks.
- Generic model-authored shell repair remains unavailable; typed supported
  capabilities and permissions apply. Unsupported repairs must report that limit.
- Existing Vite warnings remain for large optional voice/avatar chunks and
  browser-safe Node-module fallbacks in the shared task classifier. Existing
  electron-builder configuration uses asar:false and a default Electron icon.

## Reproduction and output

From `E:\chatbot` with the existing installed dependencies and local Ollama:

```powershell
npm test
npm run test:electron
node scripts/desktop-acceptance.mjs --development
node scripts/desktop-acceptance.mjs
node backend/scripts/model-route-smoke.mjs
```

Build a **fresh** output directory (the validated one already exists and is not
overwritten):

```powershell
npm run electron:release -w frontend -- --output-dir=release-desktop-next
```

The exact command that produced this deliverable was:

```powershell
npm run electron:release -w frontend -- --output-dir=release-desktop-20261008-final
node scripts/desktop-acceptance.mjs '--exe=E:\chatbot\frontend\release-desktop-20261008-final\win-unpacked\Chanakya AI.exe' --vision
```

Release paths, sizes and SHA-256 hashes are saved in
[release-artifacts.json](/E:/chatbot/docs/verification/release-artifacts.json).
Build commands do not implicitly download dependencies, overwrite older releases,
package user databases, restore a storage stash into an installer, or publish.
