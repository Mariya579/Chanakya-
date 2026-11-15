# Coding model integration and offline release checks

## Reused interfaces

- `backend/src/coding/CodingTaskRouter.js` identifies explicit project execution intent. `TaskRouter.routeTask` admits it before desktop or answer-only overrides. A route is not a workspace grant.
- `CodingModelAdapter.next({ model, task, history, tools, contextWindow, signal })` returns `{ proposal, metrics }`. The orchestrator, rather than the model adapter, dispatches validated actions and verifies completion.
- `discoverCodingModels()` returns `{ models, connected, error? }`. It reuses `services/modelRouter.js` normalization/discovery with local metadata transports. Fresh `/api/show` metadata must declare `completion` and `tools`; remote/cloud models are excluded. Discovery never pulls models or starts inference.
- `services/inferenceGate.js` serializes coding inference with other local inference. `services/modelRuntime.js` records the request-scoped coding model and context limits.
- `orchestrator/ExecutionController.js` and `AgentState.js` already provide immutable attempts, bounded steps/retries, confirmation pauses and save-before-dispatch. Map coding inspection to `plan`, diagnosis to `replan`, and unsupported execution to `error` with a precise blocker, preserving the existing state contract.
- `frontend/tools/ToolEngineRouter.js`, `security/ToolRegistry.js`, `ToolPermissionPolicy.js`, `ToolExecutionGuard.js`, and `ConfirmationGate.js` own central validation, permission decisions and one-use approvals. Existing model admission only permits the Windows route. Coding integration needs a separate route restricted to coding tool IDs; do not grant General chat computer authority.

## Verified local model discovery

On this Windows host, the new adapter's real metadata-only discovery returned four eligible installed models: `qwen3-coder:30b`, `qwen3.5:9b`, `phi4-mini:latest`, and `gemma4:e2b`. These are observations, not built-in choices. Embedding-only models were excluded. No model was downloaded or inferred for this discovery test.

The adapter uses loopback HTTP only, rejects redirects, credentials and alternate URL paths, and rejects remote model metadata even when a remote model is served through a local Ollama daemon. Each response must be a completed local response containing one schema-validated proposal. Up to two malformed-output repairs are allowed; repaired output is never executed in the adapter. Usage metrics accumulate across repairs.

Context is capped by requested context, model metadata and available host memory. Older observations are omitted when their serialized byte budget is exhausted, and the omission count is returned. A large tool catalog or task can produce `CODING_CONTEXT_TOO_LARGE`; callers should show that error and allow a supported larger context, not silently truncate tool policy.

## Packaging acceptance checks

1. `frontend/scripts/prepare-backend.cjs` already copies backend `src` into the isolated offline runtime and excludes test files. New `backend/src/coding` modules therefore travel with the backend without new dependency installation.
2. `frontend/scripts/afterPack.cjs` copies `backend-runtime` into packaged `resources/backend`. Verify coding route, model adapter, workspace services, tool schemas and migrations exist there, not only in the development checkout.
3. Existing `frontend/package.json` includes `tools/**/*`; new ToolEngine coding services placed there are included. Required native confinement binaries, if implemented, need explicit packaging and integrity validation.
4. Use `config.appDataPath`, which the packaged backend receives as a writable per-user root, for task persistence and audit metadata. Never write task history into application resources, ASAR or a selected source repository implicitly.
5. Verify packaged `better-sqlite3` with the packaged Electron ABI, using the existing build script's native dependency check. Preserve workspace ownership and schema migrations when opening recovered tasks.
6. On a clean offline Windows VM, start the packaged EXE, select an existing local model and disposable workspace, perform reads/writes/checkpoint recovery, restart the EXE, and inspect recovered state. Missing Ollama, missing models or unavailable confinement must display actionable errors and must not claim success.
7. Do not bundle the observed 18.56 GB coding model automatically. Document that users provision a local Ollama model themselves; the app offers only models actually installed and compatible.
8. Build/test subprocesses execute arbitrary project code. `shell:false`, argument validation or an executable allowlist alone are not containment. If native filesystem and network confinement is unavailable, return a blocked validation result and do not launch the process. An approval cannot substitute for confinement under this requirement.

## Repeatable benchmark record

Use new disposable workspaces for every run and a fixed suite revision. Include: a new multi-file project, nested directory creation, a targeted edit with version conflict, an injected failing test, missing tooling, an unavailable local model, malformed proposals, secret-file/traversal/junction attempts, bounded retries, cancellation and checkpoint restoration. Cover multiple project languages rather than assuming npm.

Persist the task ID, selected local model ID/digest, suite version, actual tool calls/results, executed validation commands, exit codes, durations, iteration counts, prompt/output token counts, changed paths, denied-action count, rollback result and unresolved failures. Report passed/failed/skipped/unavailable/not-run/approval-blocked/isolation-blocked separately. Task completion, test/build success, tool validity and rollback success rates require actual observed runs; scripted fixtures prove orchestration behavior, not model coding performance.

Focused adapter/router tests currently passed: 14/14. This does not demonstrate arbitrary project completion, production Windows confinement, packaged EXE operation or live model task quality.

## Primary protocol references

- [Ollama chat API](https://docs.ollama.com/api/chat): local chat request, schema `format`, runtime options and token/duration metrics.
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs): JSON Schema format and independent response validation.
