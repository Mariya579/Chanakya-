# Offline coding agent integration

## Repository audit and integration map

The desktop runs Electron (`frontend/electron/main.cjs` and `preload.cjs`), a React renderer, and an authenticated loopback Express backend (`backend/src/app.js`). The existing workspace routes authorize owned local document directories. Coding adds a separate workspace-scoped adapter; it does not change document indexing or give the general chat route filesystem authority.

| Existing component | Reuse and integration |
| --- | --- |
| `workspaceService.js`, `workspacePaths.js` | Account ownership, selected roots, available workspace list; coding write grants are separate and bound to root identity. |
| `db/connection.js` | Actual better-sqlite3 database; owned coding tasks, grants, receipts and content-free audit records. |
| `AgentState.js`, `ExecutionController.js` | Existing phases, immutable execution identities, save before dispatch, bounded retries and confirmations. Inspect maps to plan, diagnose maps to replan, blocked retains compatible error phase plus coding status. |
| `modelRouter.js`, `ollamaService.js`, `inferenceGate.js` | Live installed-model discovery, capability checks and serialized local inference. No model downloads. |
| Authenticated `api.js`, WorkspaceHub | New Coding tab, selected workspace/model, activity, file views, diffs, approvals, validation output and checkpoints. |
| Desktop directory picker and caller validation | Existing native folder selection; renderer receives no unrestricted filesystem or command API. |
| Backend runtime packager | Already copies backend/src recursively. Coding services and native file helper live under that directory and require no new package dependency. |

Missing capabilities before this change: write authorization, versioned atomic source edits, coding-specific typed tools, project snapshots, validated coding model actions, workspace-scoped task persistence, and an integrated coding panel. Existing desktop tools and Windows repair authority cannot safely serve arbitrary project execution.

## Affected files and dependency order

1. `backend/src/coding/WorkspaceFiles.js` and its fixed Windows helper: confinement, file tools, conflict checks and checkpoints. Existing document services stay intact.
2. `coding/contracts.js`, `CodingTaskRepository.js`, `CodingToolEngine.js`: fixed schemas, scoped permission adapter, approval receipts and local audit/persistence.
3. `CodingModelAdapter.js`, `CodingTaskRouter.js`, existing `TaskRouter.js`: live local model discovery and validated next actions.
4. `CodingAgentService.js`, `CommandExecutionService.js`, `routes/coding.js`, `app.js`: existing state-controller loop and authenticated routes.
5. `frontend/src/coding/CodingPanel.jsx`, existing API/sidebar/workspace navigation files: UI integration.
6. Disposable adversarial/integration tests and local benchmark fixtures; packaging review and actual acceptance evidence.

## Security and execution boundary

Repository content, model responses and terminal output are untrusted task data. They cannot grant write access, choose another root, enroll tools or approve operations. Credentials, links, alternate data streams, UNC/device paths and traversal are denied. File writes require observed SHA versions or `new`; configuration edits, deletion, restore and project commands require an exact owned single-use approval. Revoking the workspace grant stops its active task.

Arbitrary build/test code needs an OS sandbox that denies access outside the workspace and denies network, with bounded output, a secret-free environment and process-tree cleanup. The current desktop runtime has no such verified execution provider. `exec.run`, `tests.run` and Git subprocesses **fail closed with ISOLATION_UNAVAILABLE**, including after approval. This is a visible implementation limitation, not a test pass. The adapter interface permits a trusted confinement implementation later without giving a model shell access. npm/cmd wrappers, package downloads, OS administration and elevation are never silently enabled.

Offline operation uses a loopback Ollama endpoint and locally installed models only. The installed Qwen model is discovered; no model ID is hard-coded. A concrete device may have a much larger advertised model context than available RAM/VRAM supports; the coding context and output budgets stay bounded.

## Acceptance evidence

Acceptance results and remaining packaged-runtime/OS-execution limitations are recorded after tests execute. A UI build does not certify a clean-machine packaged EXE. No commit, push, cloud request or package/model installation is part of this implementation.
