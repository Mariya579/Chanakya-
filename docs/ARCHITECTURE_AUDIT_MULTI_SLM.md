# Chanakya AI — Multi-SLM + LLM Architecture: Phase 0 Audit

Date: 9 October 2026 · Scope: audit only. **No application code was changed, nothing was
committed or pushed, no model was downloaded/deleted/replaced.** This file is the only
artifact of this pass.

## 0. How to read this document

Every statement carries one evidence tag:

| Tag     | Meaning                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| **[R]** | Read directly in the repository source during this audit                                                               |
| **[M]** | Recorded in a measurement artifact already in the repo (`docs/verification/*.json`, 8 Oct 2026). Not re-measured today |
| **[I]** | Inference / hypothesis from code. Not reproduced. Must be confirmed before acting on it                                |
| **[D]** | Stated in a project design document, implementation not re-read                                                        |

**What was read:** the whole model layer (`modelRouter`, `modelRuntime`,
`modelRouteAuthority`, `ollamaService`, `inferenceGate`, `llmClient`, `config`), the
`/api/chat`, `/api/models`, `/api/orchestrate`, `/api/agent`, `/api/repair` routes, the
orchestrator (TaskRouter, AgentOrchestrator head, ComputerTaskPolicy head, AgentState,
WindowsRepairCapability, ToolEngineBridge), the whole tool-security layer (ToolEngineRouter,
ToolRegistry, ToolPermissionPolicy, TrustPolicy, LocalVisionAdapter), Electron
(`preload.cjs`, `tool.ipc.js`, `ipcTrust.js`, `BackendManager.js`, `WindowManager.js`),
docqa retrieval, `ModelSettings.jsx`, and the existing verification/design documents.

**What was NOT read** (so nothing below claims anything about it): internals of
`UIAutomationService`, `GenericDesktopService`, `AppService`/`AppDiscoveryService`,
`SoftwareService`/`ProviderRegistry`/`SoftwareResolver`, `BrowserAutomationService`,
`InstallerExecutor`, PowerShell helper scripts, `Verifier`/`Replanner`, `main.js` IPC handlers
other than by grep (`capture-screen`, `save-file`, `tts:*`), most of `frontend/src`.

**What cannot be checked from here:** this audit ran in a Linux cloud sandbox; the device-side
shell was unavailable. Nothing was executed on Windows, nothing was run against Ollama, and the
packaged EXE was not launched.

---

## 1. Key conclusion

The target architecture is **not a greenfield job**. A large part already exists and is of
good quality, especially the security layer. What is missing is mostly _model-side_:

- the model layer knows **two routes** (general / windows), not five agents or roles;
- model choice is **vendor-biased** (Qwen first) and **size-biased** (smallest first), not
  capability/health/memory-aware;
- intent routing is **regex-first and duplicated** in several places, with no single `TaskRoute`;
- residency/concurrency policy is **inconsistent** (different keep-alive and `num_ctx` per caller,
  one global serial gate) and is the most likely cause of the measured latency;
- two legacy routers (`/api/agent`, `/api/repair`) carry dead model plumbing that bypasses the
  registry and the gate — checked: they cannot execute model-generated commands in production
  (see F-06), so this is hygiene, not a safety hole.

So the plan is _extend and consolidate_: grow `modelRouter.js` into a registry, add one intent
router that wraps the existing matchers, add a resource manager under the existing gate, and
expose it in Settings. The tool/permission/approval layer is reused unchanged.

---

## 2. Architecture map (as it is today)

```
 Electron main (sandbox, contextIsolation, no nodeIntegration)            [R]
 ├─ preload.cjs  → window.electronAPI / sessionAPI / softwareAPI / toolEngine / workspaceAPI
 ├─ ipc/tool.ipc.js  (every handler wrapped in requireTrustedSender)
 │     └─ ExecutionLedger ─▶ ToolEngineRouter.dispatch
 │            ├─ validateRequest → ToolRegistry (risk, schema, timeout, scopes)
 │            ├─ ToolPermissionPolicy (auth ctx, MCP=READ only, model route, model denylist,
 │            │                        PathPolicy, availability) → ALLOW / REQUIRE_APPROVAL / DENY
 │            ├─ ConfirmationGate (durable, per-scope, exact-params, human-approved only)
 │            ├─ SecurityAudit + Ledger (idempotency keys, cancel)
 │            └─ Services: file, powershell*, cmd*, services, registry, hardware, process, network,
 │               app, uiAutomation, browser, inspector, desktop, systemSettings, winget, webInstall,
 │               software, windowsRepair      (* = CRITICAL → BLOCKED)
 ├─ toolBridgeServer  (authenticated loopback, Bearer secret) ◀── backend ToolEngineBridge
 └─ BackendManager  → spawns backend as child on an OS-assigned 127.0.0.1 port

 Backend (Express)                                                          [R]
 ├─ /api/chat       computerTask() regex → routeChatModel → inferenceGate → modelRuntime → Ollama
 │                  (signed windows tool proposals: signWindowsProposal / verifyWindowsProposal)
 ├─ /api/orchestrate TaskRouter(keywords, then LLM) → AgentOrchestrator (bounded steps/retries,
 │                  checkpoints, confirmations) → software / astra / generic-desktop deciders
 │                  → WindowsRepairCapability (Print Spooler state machine, no LLM)
 ├─ /api/models     discoverModels (/api/tags + /api/show, 30 s cache), per-user model_preferences
 ├─ /api/agent, /api/repair   LEGACY: model from request body, own default, no registry, no gate
 ├─ /api/documents, /upload   ingest → FTS5 + LanceDB + structured tables; docqa planner (rules → LLM)
 └─ /api/translate  translationService (+ optional LLM post-processing, uses inferenceGate)

 Ollama (127.0.0.1:11434 only; config.js refuses non-local OLLAMA_URL)      [R]
```

### 2.1 Where each spec concern lives today

| Spec concern        | Today                                                                                                                                                        | Evidence                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Ollama integration  | `ollamaService.js` (`/api/tags`, `/api/show`, `/api/ps`, `/api/generate keep_alive:0`, `/api/embed`, chat/stream) with timeouts (30 s default, 8 s for show) | [R]                                                              |
| Model discovery     | `discoverModels()` — batches of 3, 30 s cache, de-duplicated in-flight call, never pulls                                                                     | [R]                                                              |
| Model preferences   | `model_preferences` (SQLite, per user): `generalModel`, `windowsModel`, `keepAlive`, `contextWindow` — strict key allow-list                                 | [R]                                                              |
| Routing (model)     | `selectModelRoute()` → `route: general                                                                                                                       | windows`, required capabilities, Qwen-first then smallest `size` | [R] |
| Routing (intent)    | `computerTask()` regex (ComputerTaskPolicy) in chat; `TaskRouter` keyword-first then LLM in orchestrate; `isSpoolerIntent` regex in repair                   | [R]                                                              |
| Serialisation       | `InferenceGate`: `maxActive 1`, queue 8, queue timeout 240 s; used by chat, orchestrate, translation                                                         | [R]                                                              |
| Per-request runtime | `modelRuntime` AsyncLocalStorage carries model/keepAlive/num_ctx to `llmClient`/`desktopChat`                                                                | [R]                                                              |
| Tool authority      | HMAC-signed proposals bound to user + route (`modelRouteAuthority`); model cannot name its own route                                                         | [R]                                                              |
| Permissions         | 4 risk classes (READ / SAFE_WRITE / DANGEROUS / CRITICAL), explicit table, fail-closed if a tool lacks a class                                               | [R]                                                              |
| Approvals           | `ConfirmationGate` + durable store; approval bound to caller, task, exact params, expiry; `humanApproved` only from trusted IPC                              | [R]                                                              |
| Audit               | `SecurityAudit` records every decision incl. awaiting_approval/completed/failed; `ExecutionLedger` for idempotency/cancel                                    | [R]                                                              |
| MCP                 | `ReadOnlyMcpServer`; policy denies any non-READ or non-`mcpExposed` tool for MCP transport                                                                   | [R]                                                              |
| Repair              | Print-Spooler-only typed state machine; approval-gated start; `maxRetries 0`; verdict scope `service_running`, `userIssueResolved:null`                      | [R]                                                              |
| Software install    | Provider registry, `TrustPolicy` (publisher, thumbprint pins, hash, arch, version, elevation, capabilities, OS media = handoff only, no model-supplied args) | [R]                                                              |
| Vision              | `LocalVisionAdapter` (loopback only, no `cloud` models, confidence ≥ 0.95, private-label filter), **disabled unless configured at startup**                  | [R]                                                              |
| Documents           | Hybrid FTS5 + LanceDB, file-scoped `documentIds`, `[Page N]` labels, structured-table planner (rules first)                                                  | [R]                                                              |
| Electron hardening  | `contextIsolation`, `sandbox`, no `nodeIntegration`, `will-navigate` blocked, `window.open` denied, trusted-sender check, token only in main memory          | [R]                                                              |
| Settings UI         | `ModelSettings.jsx`: two selectors, keep-alive, context window                                                                                               | [R]                                                              |

---

## 3. Root-cause findings

Severity: **H** blocks the spec, **M** causes wrong/slow behaviour, **L** hygiene.

| ID   | Sev | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                       |
| ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| F-01 | H   | Model layer has only **two routes**. Five agents + router + embedding + vision roles cannot be assigned or validated. `validateModelPreferences` rejects unknown keys by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | [R] `modelRouter.js`                                           |
| F-02 | H   | **Vendor and size bias hard-coded in selection**: `/^qwen/i` first, then smallest disk `size`. Disk size is not a quality, RAM or tool-reliability measure (the code comment says so). When the preferred model disappears the _smallest_ model becomes the Windows tool agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [R]                                                            |
| F-03 | M   | **Fragile capability discovery.** `/api/show` failure → `{}` → capabilities `[]` → model is ineligible even for plain completion; the result is cached for 30 s. `capabilityVerified` is computed but never used by selection or UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [R] — failure path **[I]** not reproduced                      |
| F-04 | H   | **No role separation for embedding / vision / router.** `embed()` uses `config.embeddingModel` (env or `nomic-embed-text`) with no registry check or readiness state; the vision adapter takes its model from trusted startup config; translation post-processing has its own `qwen3.5:9b`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [R]                                                            |
| F-05 | M   | **Hard-coded model names** in 8 files (21 matches for `qwen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | llama3                                                         | nomic | gemma | mistral | phi3 | deepseek`in the files read):`config.defaultModel "llama3"`, `embeddingModel "nomic-embed-text"`, `supportedModels[]`, `AGENT_DEFAULT_MODEL`(agentBrain) and`DEFAULT_MODEL = AGENT_MODEL |     | "qwen3.5:9b"`(llmClient; imported by the repair/orchestrate routes,`TaskRouter`, `OrchestratorPlanner`, `GenericAppPlanner`), translate post-processing model, frontend `selectedModelId`default, plus the Qwen preference inside`selectModelRoute`. Env overrides exist for some. **Status: the names in `config.js`, `llmClient`, `agentBrain`, translation and the frontend default are removed (Stage 1b, §11). Still open: the Qwen-first preference inside `selectModelRoute`(Stage 2);`embeddingModel` is kept on purpose.** | [R] |
| F-06 | L   | **Legacy `/api/agent` and `/api/repair` are inert compatibility surfaces that still carry model plumbing.** Both accept `model` from the request body (default constant), neither calls `routeChatModel`, neither uses `inferenceGate`. _Checked and cleared as a safety problem:_ `/api/repair` → `runRepair` → `runWindowsRepair` (Print Spooler state machine, no model, `model` is ignored); `/api/agent` → Spooler repair, otherwise `runLegacyExecution`, which **hard-stops with `MODEL_CAPABILITY_DENIED`** unless a test injects `runPowerShell` ("Production model-originated shell execution is retired"). `agentBrain` (model proposes PowerShell, `dangerClassifier`) is therefore reachable only from tests. `streamAgent` exists in the frontend API client but no caller was found in the files read. Remaining issue is hygiene: dead defaults (`AGENT_DEFAULT_MODEL`) and an ignored `model` field that suggests control it does not have. | [R]                                                            |
| F-07 | H   | **Intent routing is keyword/regex-first and duplicated**: chat uses `computerTask()`, orchestrate uses `TaskRouter` (keywords, LLM fallback on `DEFAULT_MODEL`), repair uses `isSpoolerIntent`, the renderer has its own decisions. There is no shared `TaskRoute`, no confidence/margin, no compound-task structure beyond `compoundAppTask`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [R]                                                            |
| F-08 | H   | **One global serial gate.** All chats, translation post-processing and orchestration share `maxActive 1`. A cold Windows-route request (53.7 s measured) blocks everything else for that time; there are no per-model lanes, and small models (router/embedding) cannot run beside a large one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [R] + [M]                                                      |
| F-09 | H   | **Inconsistent residency and context policy → repeated model loads.** Router default `keepAlive "30s"`; non-routed callers use env default `5m`. `num_ctx` is 8192 (ollamaService, agentBrain, translation), 4096 (queryPlanner, vision), up to 32768 (desktopChat). `queryPlanner.js` itself notes that a different `num_ctx` makes Ollama reload the model. Measured cold loads were 7.7 s (general) and 19.5 s (windows) — they recur whenever the user pauses > 30 s or a caller changes `num_ctx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [R] + [M]; causal claim **[I]** until before/after measurement |
| F-10 | M   | **No memory-aware scheduling.** Free/total RAM and model disk size are attached to the route object but never used for a decision; `/api/ps` is read only by `/models/loaded`; "unload all" is retired server-side. No eviction, no max-loaded cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [R]                                                            |
| F-11 | M   | **No health/circuit-breaker/OOM handling** in the routing layer: no per-model success/latency history, no "unhealthy → skip", no retry-with-smaller-context. Timeouts exist per HTTP call only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [R] (portions read)                                            |
| F-12 | M   | **Vision path is slow and unregistered.** In the packaged acceptance run the image route fell back to `qwen3.5:9b` ("selected model `qwen:latest` unavailable or incompatible") and took **104.9 s** for a one-word answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [M]                                                            |
| F-13 | M   | **Settings UI is minimal**: no refresh, no capability/verified badges, no per-agent assignment, no model test, no readiness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [R]                                                            |
| F-14 | M   | **Fallback is visible but not policy-driven.** The `route` event carries `fallback` + `reason`, but there is no rule distinguishing "fallback for chat" from "fallback for a tool-executing agent". "Tools" capability is taken from Ollama metadata only; there is no per-model tool-call reliability record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [R]                                                            |
| F-15 | L   | Document agent gaps: image/scan files are rejected for indexing ("Images and videos cannot be indexed"); no OCR path wired to a registry-selected vision model; embedding-model readiness not surfaced. Page labels and file scoping already exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [R]                                                            |
| F-16 | M   | Repair is a **single-fault** state machine (Print Spooler). It is a faithful implementation of diagnose → approve → execute → verify with honest verdict wording, but there is no fault catalogue, no local-knowledge retrieval step and no generic planner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [R]                                                            |
| F-17 | L   | Install paths are duplicated: `winget.install`, `webInstall.install`, `software.install` (all DANGEROUS, 21-minute timeouts). `software` is the policy-complete one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [R]                                                            |
| F-18 | L   | Permission classes live in one hand-maintained table in `ToolRegistry.js`. It fails closed (missing entry → throws), but additions are manual.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [R]                                                            |
| F-19 | L   | Test inventory is thin around the model layer: 7 backend test files (`inferenceGate`, `modelRouter`, `ollamaTransport`, `powershellLifecycle`, `profilePersistence`, `softwareFlow`, `translationFallback`) plus docqa tests. No test for routing intent, memory/residency, or health. Tool-layer test location not found (`frontend/tests` does not exist).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [R]                                                            |

### 3.1 Security posture (Phase 11 — already strong)

Present and verified by reading: local-only Ollama enforcement (`config.js`, `LocalVisionAdapter`
loopback + `cloud` model rejection); `contextIsolation`/`sandbox`; trusted-sender wrapper on IPC;
IPC allow-list in `preload.cjs`; typed proposals only (`validateRequest`); schema validation per
tool (`validateParameters`); HMAC-signed model proposals so a model cannot grant itself a route;
`humanApproved` only from trusted IPC; approval bound to exact params + task + expiry; MCP =
READ-only allow-list; CRITICAL operations (format disk, BitLocker, defender/firewall off, domain
join, …) registered and blocked; audit trail; log redaction of the bridge secret; installer
arguments can never come from model or feed; model-originated PowerShell execution is retired in
production (`LegacyExecutionAdapter` hard-stops with `MODEL_CAPABILITY_DENIED`, `powershell.*`/`cmd.*`
are CRITICAL→BLOCKED in the Tool Engine registry).

To review (not done in this pass): `capture-screen`, `save-file(name, base64)` and `tts:*` handlers
in `main.js` (input validation / path handling); `workspace:choose-directory`; whether any
renderer code path can reach `/api/agent`.

---

## 4. Baseline (what is actually on record)

All numbers are from files already in the repo; none were produced today.

| Item                                         | Value                                                                                                                                     | Source                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| General route, `qwen:latest`                 | 9.0 s total; load 7.7 s; first token 8.7 s; prompt eval 1.0 s (24 tok); 4 tokens generated                                                | [M] `local-model-routes.json`  |
| Windows route, `qwen3.5:9b`, 1 tool proposal | 53.7 s total; load 19.5 s; **prompt eval 28.0 s for 298 tokens**; generation 6.2 s (15 tok); 0 tools executed                             | [M]                            |
| Hardware at that audit                       | 23.87 GiB RAM (11.85 GiB free), Intel UHD 620, no dedicated VRAM → CPU-bound inference                                                    | [M]                            |
| Resident models after run                    | none                                                                                                                                      | [M]                            |
| Packaged EXE (`win-unpacked`, 8 Oct)         | 26 acceptance checks, all pass; cold start to interactive 20.7 s, restart 6.0 s; backend stops on close; unrelated :3001 server untouched | [M] `packaged-acceptance.json` |
| Idle Electron working set                    | 131.9 + 196.6 + 259.2 + 260.9 MB ≈ **829 MiB** (4 processes)                                                                              | [M]                            |
| Local vision answer ("Blue")                 | 104.9 s via fallback `qwen3.5:9b`                                                                                                         | [M]                            |

Caveats: the acceptance run **predates** the 9 Oct changes (translation fallback, per-chat
generation, projection planner, workspace-source hiding), so it must be re-run on a rebuilt EXE.
The hardware row describes the machine used for that run; the target machine must be re-measured.
There is **no** recorded measurement of incorrect-tool-call rate, unsafe-action rate, peak RAM
per model, or success rate by agent — those are Phase 12 outputs, not baseline.

---

## 5. Gap analysis against the 13 phases

Status: **Have** (meets spec), **Partial**, **Missing**.

| Phase                             | Status               | What exists                                                                                                          | What is missing                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Audit                           | Have                 | this document                                                                                                        | on-device measurements (§4 caveats)                                                                                                                                                                                                                                                                                                     |
| 1 LocalModelRegistry              | Partial              | dynamic discovery, capability metadata from Ollama, cache, in-flight de-dup, never downloads                         | provenance per field (ollama/cached/unknown; user overrides in Stage 2); roles; persistence of last-known snapshot for offline start; health state; missing-model handling after assignment; refresh endpoint + UI; remove hard-coded names (F-05); fix F-03                                                                            |
| 2 Intent router                   | Partial              | regex matchers, `TaskRouter` LLM fallback, `compoundAppTask`                                                         | `TaskRoute` contract; confidence + margin; single entry point; router-model selection from registry; compound plan with ordered sub-routes; no large-model load to classify — **Stage 2/3 (§11): rules-based `classifyIntent` → `TaskRoute` now exists for chat and orchestrate; no compact-classifier model, no compound sub-routes.** |
| 3 Document agent                  | Mostly have          | hybrid retrieval, file scope, `[Page N]`, structured planner, attachment ↔ message binding                           | evidence-sufficiency gate, OCR/vision path via registry, embedding readiness                                                                                                                                                                                                                                                            |
| 4 Repair agent                    | Partial              | spooler state machine: diagnose → approve → act → verify, bounded, honest verdict                                    | fault catalogue, local-knowledge retrieval, generic planner/validator                                                                                                                                                                                                                                                                   |
| 5 OS control                      | Have (policy)        | 4 risk classes, schemas, deterministic executor, audit, least-privilege scopes                                       | none structural; add registry-driven "which model proposed this" to the audit record                                                                                                                                                                                                                                                    |
| 6 App automation                  | Partial / unverified | discovery, resolver, UIA services, observe/act/verify services, orchestrator Observe→Plan→Act→Verify, vision adapter | real-Windows verification; vision adapter bound to registry; model-required-for-image-inspection gate                                                                                                                                                                                                                                   |
| 7 Software install                | Have (design)        | provider registry, TrustPolicy, offline repositories, approval, publisher/signature/hash/version checks              | retire duplicate winget/webInstall paths behind `software` (needs user OK); live-install verification                                                                                                                                                                                                                                   |
| 8 Capability selection + fallback | Partial              | capability filter, `fallback` flag + reason                                                                          | per-agent selection, safe-fallback rules (§7.3), health-aware skipping — **Stage 2/3 (§11): per-agent selection by declared capability + family hints, `fallbackModel`, pins; runtime retry on a failed load is still missing.**                                                                                                        |
| 9 Resource management             | Partial              | keep-alive setting, context cap, abort signals, queue bound/timeout                                                  | unified residency/`num_ctx`, memory-aware preflight, eviction, per-model lanes, OOM recovery, idle unload policy, before/after measurement                                                                                                                                                                                              |
| 10 Settings UI                    | Partial              | model selectors, keep-alive, context                                                                                 | "AI Models and Agents" page (§8)                                                                                                                                                                                                                                                                                                        |
| 11 Security                       | Have                 | see §3.1                                                                                                             | review items listed in §3.1                                                                                                                                                                                                                                                                                                             |
| 12 Tests/benchmarks               | Missing              | few model-layer tests                                                                                                | fake-Ollama test harness, golden intent corpus, bench script, results recorded from the user's PC                                                                                                                                                                                                                                       |
| 13 EXE verification               | Have for 8 Oct build | `packaged-acceptance.json`                                                                                           | re-run after rebuild (user machine)                                                                                                                                                                                                                                                                                                     |

---

## 6. Target architecture (extension, not rewrite)

```
 Request ─▶ IntentRouter (new, wraps existing matchers)
              A. deterministic matchers  (computerTask, settingsChangeTask, isSpoolerIntent,
                 software intent, attachment/workspace scope, compoundAppTask)  → TaskRoute[]
              B. only if confidence < τ or margin < δ → small router model (registry role "router"),
                 JSON-schema constrained, temperature 0, bounded tokens; reuses TaskRouter.routeTask
              ─▶ TaskRoute { intent, agentId, requiredCapabilities, confidence,
                              selectedModel?, fallbackModel?, requiresTools, requiresApproval }
 TaskRoute ─▶ AgentRegistry  (data, not code paths)
              document · repair · os_control · app_automation · software_install · general
 each agent ─▶ ModelSelector.selectForAgent(agentId, requirements)   ─ reads LocalModelRegistry
 each agent ─▶ ResourceManager.admit(model)  ─ residency, memory preflight, lanes, timeouts
 tool-executing agents ─▶ existing signed proposal → ToolEngineRouter (unchanged)
                          model output is data; only typed, schema-valid, signed proposals execute
```

### 6.1 Reuse map

| Spec component     | Reuse                                                                                                           | New                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LocalModelRegistry | `discoverModels`, `normalizeDiscoveredModel`, `model_preferences`, `listLoadedModels`                           | `services/modelRegistry.js` (snapshot table, provenance, health, roles), `/api/models/registry`                                                                                                     |
| Agent assignments  | per-user preference table pattern                                                                               | `agent_model_assignments` (user, agentId, preferred, fallback); legacy `generalModel`→{general, document}, `windowsModel`→{repair, os_control, app_automation, software_install} when no row exists |
| IntentRouter       | `computerTask`, `ComputerTaskPolicy`, `TaskRouter.routeTask`, `isSpoolerIntent`, `compoundAppTask`              | `orchestrator/IntentRouter.js` + golden corpus                                                                                                                                                      |
| ResourceManager    | `inferenceGate`, `modelRuntime`, `ollamaService.listLoadedModels/unloadModel`                                   | `services/resourceManager.js` (lanes, preflight, eviction, health)                                                                                                                                  |
| Agents             | Document: docqa + retrieve; Repair: `WindowsRepairCapability`; OS/app/software: existing deciders + Tool Engine | thin `AgentDescriptor` records (id, required capabilities, risk ceiling, deterministic-first flag)                                                                                                  |
| Settings           | `ModelSettings.jsx`, `/models/settings`                                                                         | "AI Models and Agents" sections                                                                                                                                                                     |

---

## 7. Design details

### 7.1 LocalModelRegistry record

```
ModelRecord {
  id, family, parameterSize, quantization, sizeBytes,
  contextWindow,                       // from /api/show model_info
  capabilities: string[],              // as declared by Ollama: completion, tools, vision, embedding, thinking…
  provenance: { capabilities: 'ollama'|'cached'|'unknown'|'user',   // 'user' = Stage 2, not implemented yet
                contextWindow: same set },
  userOverrides?: { capabilitiesAdd?: string[], notes?: string },   // Stage 2: user-configured, always labelled
  health: { state: 'ready'|'unknown'|'degraded'|'failed', lastCheckedAt, lastLatencyMs, lastError? },
  residency: { loaded: boolean, expiresAt?, sizeInMemory? },        // from /api/ps
  stale: boolean                       // snapshot served while Ollama is down
}
```

Rules (as implemented in Stage 1, see §11): capabilities declared by `/api/show` now are source
`ollama`. If `/api/show` fails for a build (digest) that was verified earlier, that earlier
declaration is reused and labelled `cached`. Otherwise the model stays **visible** with source
`unknown` and **no capabilities** — they are never guessed from a name or family (this is the
existing design and `modelRouter.test.mjs` asserts it), so an unknown model can never be offered
for tool use or approval-bound work. No in-request retry is made (it would stack the 8 s `/api/show`
timeout onto a chat request); instead a partial result is cached for 5 s instead of 30 s, so the
next request asks again. Later stages add user overrides (always labelled, and unable to satisfy
a tool-executing agent unless the user explicitly sets "trust this model for computer actions").
The registry only calls `GET /api/tags`, `POST /api/show`, `GET /api/ps`. It never calls
pull/delete/copy/create — a unit test asserts this against a recording fake of Ollama.

Persistence: last-known snapshot in SQLite so the Settings page and routing still describe
installed models when Ollama is stopped (`stale:true`), and refresh/health results survive restart.

### 7.2 TaskRoute and router policy

```
TaskRoute { intent, agentId, requiredCapabilities[], confidence, selectedModel?,
            fallbackModel?, requiresTools, requiresApproval }
```

- Deterministic pass first (existing matchers become scorers returning `{route, confidence}`).
  Accept without any model if `confidence ≥ τ` and the runner-up is `δ` lower.
- Model-assisted pass only for ambiguous input, using the smallest installed completion model that
  is **already resident** (via `/api/ps`) or under a configurable size ceiling; if none qualifies
  the router stays deterministic and asks the user a one-line clarifying question instead of loading
  a large model. τ, δ and the size ceiling are configuration, calibrated from the benchmark — not
  fixed numbers in this audit.
- Router output is parsed against a schema; anything else → `general` route with
  `requiresTools:false`. A router can _lower_ privilege, never raise it: `requiresApproval` is
  recomputed from the Tool Engine registry, not trusted from the router.
- Compound requests ("open X and play Y") become an ordered `TaskRoute[]`; each sub-route has its
  own approvals; failure of one stops the chain.

### 7.3 Model fallback rules (safety-first)

1. Order: user-assigned preferred → user-assigned fallback → automatic candidate.
2. Automatic candidates must satisfy the agent's required capabilities with **verified**
   provenance, be `health ≠ failed`, and fit the memory preflight.
3. **Tool-executing agents** (repair, os_control, app_automation, software_install): an automatic
   candidate is used only if the user has allowed automatic selection for tools (default **off**
   once the registry is on; the current behaviour is "on"). Otherwise the agent reports
   "no approved model for computer actions" and **performs nothing**.
4. Every fallback is announced in the `route` event with reason and shown in the approval card
   ("proposed by model X (fallback)").
5. Deterministic capabilities (Print Spooler repair, software provider flow, settings actions that
   need no model) keep working with **no model installed**.
6. A model is never silently swapped between _planning_ and _verification_ of the same task.
7. Automatic ranking replaces the Qwen-first/smallest-first sort with: verified capability fit →
   health → fits-in-memory → user pin → measured latency from the local benchmark (when present) →
   parameter size. No vendor name appears in code.

### 7.4 Resource manager

- One **residency policy** per model (keep-alive) and one **`num_ctx` per resident model**, so a
  caller can no longer force a reload by asking for a different context (F-09). Callers get
  `min(requested, resident ctx)`.
- **Preflight** before loading: `/api/ps` + `os.freemem()` + `sizeBytes`; if the new model does
  not fit, evict least-recently-used _idle_ models with `keep_alive:0`; if it still does not fit,
  fail fast with a clear message instead of starting a swap storm.
- **Lanes**: heavy generation stays serialized (today's behaviour, correct for CPU-only hardware);
  small roles (router, embedding) may run beside it when preflight allows. Queue bound and timeout
  stay; cancellation via the existing `AbortSignal`.
- **Failure handling**: timeout or Ollama 5xx → mark `degraded`, retry once with a smaller
  `num_ctx`, then fail with a user-readable message; repeated failures → `failed` until a manual
  test or refresh succeeds. No stack traces to the chat.
- **Measurement**: wrap each call to record load/prompt-eval/generation (Ollama returns these) into
  a local table so the Settings "test model" and the benchmark share one source of truth.

---

## 8. Settings UI — "AI Models and Agents"

Sections: **Installed models** (name, size, context, capability chips with a source badge (Ollama /
cached / unknown / user), health, resident now, Refresh, Test); **Agent assignments** (per agent: preferred +
fallback, filtered to eligible models, readiness line such as "Ready" / "No model with tool
support"); **Resources** (keep-alive, max context, "allow automatic model for computer actions",
"unload idle after"); **Readiness** summary. No raw JSON, no stack traces; failures are one-line
messages. Nothing on this page downloads, deletes or replaces a model.

---

## 9. Staged implementation plan

Each stage is additive, keeps current behaviour when no new settings exist, ships with tests, and
is installed only after restaging and checksum-comparing the device file (other sessions edit this
tree). No GitHub push/commit at any stage.

| Stage | Content                                                                                                                                                                                                                                                                                                                                                                                 | Tests (all use a fake Ollama; no real model needed)                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | `modelRegistry.js` + snapshot table + provenance + health + `/api/models/registry` (+ refresh, test); fix F-03; routed callers that pass no model take the routed model from `modelRuntime` before any constant; legacy `/api/agent` & `/api/repair` left untouched (inert, F-06); remaining hard-coded defaults replaced by registry-derived ones in later stages (env overrides kept) | discovery, missing model, `/api/show` failure, offline snapshot, cache/refresh, **no pull/delete/copy call is ever made**    |
| 2     | `agent_model_assignments`, `selectForAgent`, fallback rules §7.3, legacy-preference migration; `selectModelRoute` keeps its signature                                                                                                                                                                                                                                                   | capability matrix, fallback ladder, tool-agent refusal, existing `modelRouter.test.mjs` still green                          |
| 3     | `IntentRouter` + `TaskRoute`; `computerTask`/`TaskRouter`/`isSpoolerIntent` become scorers; router model via registry                                                                                                                                                                                                                                                                   | golden corpus (EN + Tanglish; **self-authored — reported as such**), compound routes, "never load a large model to classify" |
| 4     | `resourceManager.js`: unified keep-alive / `num_ctx`, preflight + eviction, lanes, failure handling, per-call timings                                                                                                                                                                                                                                                                   | residency/eviction simulation, OOM/timeout recovery, queue bounds, cancellation                                              |
| 5     | Settings "AI Models and Agents" page                                                                                                                                                                                                                                                                                                                                                    | component test + (user machine) visual check                                                                                 |
| 6     | Agent descriptors; Document evidence gate + OCR hook only when a vision model is registered; Repair fault-catalogue scaffold with Print Spooler as entry #1; OS/app/software wired to router (no new executors)                                                                                                                                                                         | docqa suite, repair state-machine tests, permission-denial tests                                                             |
| 7     | `scripts/bench-models.mjs` + packaged-EXE re-verification checklist                                                                                                                                                                                                                                                                                                                     | **runs on the user's PC only**                                                                                               |

Order of value for the demo-week reality: 1 → 2 → 4 → 5 give the visible gains (latency,
selectable models, no hard-coded names). 3 and 6 are larger and should not land the same day as a
demo build. Registry features that change behaviour (§7.3 rule 3, unified `num_ctx`) ship **behind
a setting that defaults to today's behaviour** until measured on the target machine.

---

## 10. Limitations of this audit and of what can be claimed later

- Nothing here was executed on Windows or against a live Ollama. Latency and RAM statements are
  the 8 Oct recorded values; "why it is slow" (F-09) is a hypothesis until the before/after run.
- Windows UI Automation, browser automation, installer execution, UAC and reboot-pending
  behaviour **cannot** be verified from the Linux sandbox. They will be reported as _implemented
  and unit-tested with controlled adapters_ at most, never as "verified on Windows".
- The packaged-EXE claim in §4 belongs to the 8 Oct build. Any claim for a later build requires
  the user to run `build-exe.cmd` and the acceptance run on the actual binary.
- Benchmarks (success rate, incorrect-tool-call rate, unsafe-action rate, latency, peak RAM, CPU,
  load time, recovery) need the user's models and hardware. Scripts will be provided; results will
  be recorded only from real runs. No model will be declared better than another without that data.
- Items in §0 "not read" and §3.1 "to review" are open, not cleared.

---

## 11. Implementation log

### Stage 1 — registry core (installed 9 Oct 2026, additive)

Files (originals saved in `_cleanup_archive\multislm-originals-20261009\*.before-stage1`):

| File                                    | Change                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/services/modelRegistry.js` | **new** — persisted read-only snapshot (`model_registry_snapshot`, created with `IF NOT EXISTS`), provenance, roles, residency from `/api/ps`, health recording, missing-model tracking, stale/offline mode, assignment status (`auto/ready/missing/incompatible`)                                                                        |
| `backend/src/services/modelRouter.js`   | `discoverModels`: no longer swallows `/api/show` failures into an empty (ineligible) model — keeps the model visible, reuses the earlier declaration only for the identical digest, caches a partial result for 5 s. `normalizeDiscoveredModel` gains `capabilitySource`, `digest`, `modifiedAt` (additive). `selectModelRoute` untouched |
| `backend/src/services/modelRuntime.js`  | adds `routedModelOr(fallback)`                                                                                                                                                                                                                                                                                                            |
| `backend/src/ai/llmClient.js`           | `completeJSON` with no explicit model follows the routed model instead of the fixed `qwen3.5:9b` tag                                                                                                                                                                                                                                      |
| `backend/src/routes/models.js`          | adds `GET /api/models/registry` and `POST /api/models/registry/refresh` (both require sign-in; refresh is throttled to one Ollama round-trip per 2 s). Existing routes unchanged                                                                                                                                                          |
| `backend/tests/modelRegistry.test.mjs`  | **new** — 12 tests                                                                                                                                                                                                                                                                                                                        |

Verification actually performed (cloud Linux sandbox, Node 22, fake Ollama, in-memory SQLite):

- 12 pre-existing model tests (`modelRouter`, `ollamaTransport`): pass, unmodified.
- 12 new registry tests: pass. Three deliberate mutations (digest check removed, partial TTL
  lengthened, tool role without verification) each made a test fail, then were reverted.
- 5 route wiring tests with real Express (auth/memory/db stubbed; sandbox-only, not shipped): pass —
  401 without sign-in, provenance/residency/host memory in the payload, refresh throttle,
  Ollama-down answers 200 with `connected:false` and a one-line error, only
  `GET /api/tags`, `POST /api/show`, `GET /api/ps` ever called.

Not verified: behaviour against a real Ollama; the routes on the real Express app with the real
auth middleware and database on Windows; any effect on latency (Stage 1 does not change
residency or context policy); the packaged EXE. Behaviour of model selection for chat is
intentionally unchanged.

### Stage 1b — no built-in model list or model names (installed 9 Oct 2026)

Request: "config.js la model list agala". The list and the fixed tags are gone from `config.js` and from the
files that fell back to them. Originals: `_cleanup_archive\multislm-originals-20261009\*.before-configfix`.

| File                                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/config.js`                                                                          | `supportedModels[]` removed (nothing imported it). `defaultModel` is `""` unless `DEFAULT_MODEL` is set (was `"llama3"`). Translate `postProcessingModel` is `""` unless an env var pins it (was `"qwen3.5:9b"`). **`embeddingModel` stays `nomic-embed-text` by design**: it is the vector format of the existing document index, so changing it silently would orphan indexed documents; override only with a re-index |
| `backend/src/services/modelRouter.js`                                                            | adds `resolveGeneralModel({configured, userId})`: a pinned tag is used only if it is installed and can complete text, otherwise the General route decides (the user's saved General model when a user is known); throws the router's "no installed model" error when nothing is installed                                                                                                                                |
| `backend/src/services/translationService.js`, `translationPostProcess.js`, `routes/translate.js` | the Ollama fallback / polish pass use `resolveGeneralModel`; no installed model gives the existing clear 503 and nothing is sent to a model                                                                                                                                                                                                                                                                              |
| `backend/src/ai/llmClient.js`                                                                    | `DEFAULT_MODEL` is `""`; `completeJSON` with no model follows the routed model, and throws "No local model is selected…" instead of sending a made-up tag                                                                                                                                                                                                                                                                |
| `backend/src/ai/desktopChat.js`, `backend/src/agent/agentBrain.js`                               | same rule (callers that pass an empty default follow the routed model; none selected → clear error, no request)                                                                                                                                                                                                                                                                                                          |
| `backend/src/routes/chat.js`, `backend/src/server.js`                                            | request-body model default no longer reads `config.defaultModel` (the route already always used the router's choice); start-up log says models are discovered at run time                                                                                                                                                                                                                                                |
| `backend/src/services/modelRegistry.js`, `routes/models.js`                                      | `GET /api/models/registry` also reports `embedding: {configured, state: ready/missing/unknown/incompatible, message}` so a missing embedding model is visible instead of silent                                                                                                                                                                                                                                          |
| `frontend/src/stores/useAppStore.js`                                                             | `selectedModelId` defaults to `""`; the existing `fetchModels()` already selects the first installed model when the saved id is not installed                                                                                                                                                                                                                                                                            |
| `backend/tests/translationFallback.test.mjs`, `modelRegistry.test.mjs`                           | fake Ollama now answers `/api/tags` + `/api/show`; new tests for pinned-only-if-installed, no installed model, `resolveGeneralModel`, `describeEmbedding`, and a source scan that fails if `config.js` ever carries a model list or a quoted model tag again                                                                                                                                                             |

Verification actually performed (cloud Linux sandbox, Node 22, fake Ollama): `modelRegistry`,
`translationFallback`, `modelRouter`, `ollamaTransport` test files plus three sandbox-only wiring tests
(`completeJSON` guard, `desktopChat` guard, registry route with the `embedding` field): 47 tests, 47 pass.
Two deliberate mutations (a model list put back into `config.js`; a built-in tag put back into `llmClient`)
each made tests fail, then were reverted. The 15 installed files were re-read from the device and are
byte-identical to the tested copies.

Not verified: a real Ollama, a real Windows run, the packaged EXE (it must be rebuilt with `build-exe.cmd`
for any of this to reach the installed app). `routes/agent.js` still takes `model = AGENT_DEFAULT_MODEL`
from the request body; that legacy route is unchanged apart from now failing with a clear message when the
model is empty. A machine with no chat model installed is untested beyond the fake Ollama.

### Stage 2 + 3 — agent profiles, rules intent router, per-agent model selection (installed 9 Oct 2026)

Request: assign the model per task from the owner's candidate table (Gemma 4 E2B documents, EmbeddingGemma search,
Phi-4 Mini repair, Qwen3.5 4B/9B OS control, Ministral 3 3B app control, existing Qwen install, rules router) so that
the right model is chosen automatically from the query. Originals: `_cleanup_archive\multislm-originals-20261009\*.before-agents`.

How it works:

1. `services/intentRouter.js` (new, pure, no model call): `classifyIntent({message, computerRequest, hasAttachments,
hasImages, wantsKnowledge})` returns the `TaskRoute` fields `intent, agentId, requiredCapabilities, confidence,
requiresTools, requiresApproval`; `toTaskRoute` adds `selectedModel` and `fallbackModel`. `requiresTools` is copied
   from the existing admission policy (`computerTask`), never decided here, so a request with no `computerRequest` can only
   get an agent of the tool-free General route. `requiresApproval` is advisory; approval stays enforced per tool by the
   existing ToolPermissionPolicy / ConfirmationGate.
2. `services/agentProfiles.js` (new): six agents (`general-chat`, `document-intelligence`, `windows-repair`,
   `os-control`, `app-automation`, `software-install`). Each states the routes it may run on, the capabilities Ollama must
   **declare**, and family **hints** (`gemma`, `phi`, `qwen`, `ministral`/`mistral`) that only **order** models that are
   already eligible. A hint never makes a missing, unverified, embedding-only or capability-lacking model eligible. No profile
   names a model tag. `AGENT_MODEL_HINTS=off` switches the ordering off.
3. `selectModelRoute({agentId})` (additive): explicit choices first (per-agent pin in `preferences.agentModels`, then the
   existing General / Windows model), then hint order, then the previous Qwen-first / smallest rule. An agent that does not
   belong to the current route is ignored, so an agent can never change the route. The result adds `agentId`, `selection`
   (`pinned-agent | pinned | auto-hint | auto`), `fallbackModel`, `agentReason`; existing fields are unchanged.
4. Wiring: `routes/chat.js` and `routes/orchestrate.js` (run and resume) pass the agent to `routeChatModel`. The chat `route`
   event gains `agent`, `agentLabel`, `intent`, `confidence`, `fallbackModel`, `selection`; the front-end status line now reads
   e.g. "Reading and preparing a response (Document Intelligence · <model>)".
5. Settings data: `GET /api/models/registry` returns `agents[]` (per agent and route: the model it would use now, its fallback,
   why, whether a recommended family is installed) built by the same selection code, plus `embedding.suggestion`.
   `PUT /api/models/settings` accepts `agentModels` (validated against installed models and their declared capabilities); an older
   client that omits it does not wipe the saved choices.

Behaviour guarantees (each covered by a test): with only today's two Qwen models installed every agent selects exactly what
the old General / Windows routes selected; nothing is downloaded, deleted or replaced; the embedding model is not switched
(different vector size means a re-index) and is only reported as a suggestion.

Verification actually performed (cloud Linux sandbox, Node 22, fake Ollama, in-memory SQLite): 74 tests, 74 pass
(22 new in `tests/agentRouting.test.mjs` — shipped; 5 sandbox-only wiring tests against real Express for the registry
`agents` payload, saving/validating `agentModels` and the omitted-field case). Five deliberate mutations (hints ignored,
route guard removed, ranking ignoring capability, tools flag forced, pin precedence swapped) each made tests fail, then were
reverted. The 9 installed files were re-read from the device and are byte-identical to the tested copies, and the shipped tests
were re-run against those device copies.

Not verified, and limits: a real Ollama and the candidate models themselves (their Ollama tags, whether they declare
`tools`/`vision`, and their quality are unknown here; selection only trusts what `/api/show` reports); `routes/chat.js` and
`routes/orchestrate.js` were syntax-checked and statically scope-checked, not executed; the packaged EXE (needs
`build-exe.cmd`). The intent router is keyword rules, not a classifier model, and its keyword sets are self-authored, so a
phrasing outside them falls to General chat. Switching models between agents costs a load each time (baseline: 7.7 s and
19.5 s load for the two Qwen models on this PC) and the inference gate serialises requests; whether several small models beat
one larger one on this machine is unmeasured (Stage 4/7). A failed model load at run time does not yet retry with
`fallbackModel`. There is no Settings UI for the per-agent choices yet (Stage 5); the API and registry data are in place.

### Stage 8 — offline translator pack for another PC (installed 9 Oct 2026, additive)

Request: the IndicTrans2 translator must work on a PC that only gets the application. Finding: the packaged backend ran the
translator only from `INDICTRANS_SERVICE_DIR` or from `indictrans-service/` beside `backend/`, and the installer never
contains the Python environment or the models, so on a second PC translation was simply "unavailable". Measured on this PC:
the three `model.safetensors` files are 3.30 GB (1.10 + 0.91 + 1.28 GB) and each model folder also holds a duplicate
`pytorch_model.bin` of the same size. A 3.3 GB payload plus Python and torch does not belong in the NSIS installer (limit about
2 GB — not tested), so the translator travels as a folder next to the exe.

What changed (additive; a development checkout behaves as before):

1. `backend/src/services/indictransProcess.js`: `locateTranslatorService` looks, in order, at `INDICTRANS_SERVICE_DIR`, the
   `indictrans-service/` folder beside `backend/`, `translator/` and `resources/translator/` beside the exe, and `translator/` in
   the app data folder. A folder counts only with `app/main.py`, `models/` and a Python (a pack's own `python/python.exe`, else
   `.venv`). `C:\ProgramData` and other folders any local user can create are deliberately not searched, because the app runs the
   Python it finds. `planTranslatorLaunch` gives a pack `INDICTRANS_MODEL_PATH` (unless set by the environment or the folder's
   `.env`), `PYTHONNOUSERSITE=1` and offline Hugging Face flags; the service is still bound to the loopback host the app already
   allows. The service's output now goes to `indictrans.log` in the data `storage` folder (5 MB cap) instead of being discarded,
   and the "not found" warning lists every folder checked.
2. `scripts/translatorPack.mjs` + `scripts/build-translator-pack.mjs` + `build-translator-pack.cmd`: build, on the PC where
   translation already works, a fresh folder containing a copy of the base Python named by `.venv/pyvenv.cfg` (no docs, headers,
   tests, IDLE or pip) with the venv's packages, `app/`, the three models (`model.safetensors` only unless `--keep-bin`; the
   Hugging Face `.cache` bookkeeping is skipped), Microsoft's C++ runtime DLLs found in `System32`, and `pack-manifest.json`
   (SHA-256 of every model file). File times are preserved so compiled `.pyc` files stay valid on a read-only install. Nothing in
   the source folders is changed, a non-empty output folder is refused, free disk space is checked first, and a validation
   failure writes nothing.
3. `scripts/translator-pack/`: `selftest.py` (manifest hashes, imports, service started from the pack folder on a spare port
   with all three models loaded, one English → Tamil and one Tamil → English sentence in the right script),
   `Verify-Translator.cmd`, `Start-Translator.cmd`, `Install-Translator.cmd`, `README.txt`. The builder runs the self-test from the
   new location at the end.
4. `.gitignore` gets `translator-pack/` so a 5 GB build output is not committed by accident.

Verification actually performed (cloud Linux sandbox, Node 22, Python 3): 75 tests pass in total (11 in
`tests/indictransLocate.test.mjs`, 7 in `tests/translatorPack.test.mjs`, both shipped). Mutations that each made a test fail
and were reverted: duplicate weights shipped, `.gitattributes` / `.cache` shipped, CRLF conversion dropped, non-empty output
accepted, pip included, `Lib/test` included, model validation skipped, `C:\ProgramData` searched, model path not set for a pack,
offline flags dropped, `.venv` Python preferred over the pack's, file times not preserved. `selftest.py` was run against a
stand-in service (real FastAPI/uvicorn, fake torch/transformers modules): it passes on the good case and fails (exit 1) for a
corrupted model file, a service that crashes at start-up and a translation in the wrong script; no process was left running.
The builder command line was run on a small fixture. The 19 previously installed files were compared with the device after the
repository-wide Prettier run described below: Prettier applied to the tested copies reproduces the device files byte for byte,
and all 75 tests pass with the device copies in place.

Not verified, and limits: no pack has been built from the real `.venv` and models, so whether a copied base Python plus the
venv's packages runs torch/transformers on a second PC is untested (`Verify-Translator.cmd` is the check, ideally in Windows
Sandbox or on a PC that never had Python); the `.cmd` files were reviewed but not executed (no Windows here); `Install-Translator.cmd`
into `C:\Program Files` needs administrator rights; the NSIS size limit was not tested; the models need about 4 GB of free memory
while loaded and the app starts the translator on every launch (`INDICTRANS_AUTOSTART=0` turns that off); `trust_remote_code`
makes transformers write a small module cache under the user profile, so the profile must be writable; translation quality is not
judged by the self-test.

Related finding (not caused by this stage): a repository-wide `npm run format` ran at about 19:37 and 19:41 IST on 9 Oct 2026.
Because `.prettierignore` does not exclude `indictrans-service/.venv` or `indictrans-service/models`, Prettier also rewrote
non-Python files there (model `config.json`, `dict.*.json`, `tokenizer_config.json`, `README.md`, and `.js` / `.mjs` / `.html` files under
`site-packages`). JSON and JavaScript keep their meaning when reformatted, but the translator should be run once afterwards (the
Verify script does this). `indictrans-service/.venv` and `indictrans-service/models` are now listed in `.prettierignore` so it does
not happen again.

### Correction — every chat failed after Stage 2 + 3 (found and fixed 9 Oct 2026, evening)

Symptom: each chat message ended with "This response could not be completed. Try again or check Diagnostics." (the generic
fallback in `routes/chat.js`, shown for any error that has no specific message). The backend console showed
`[chat] response failed: agentProfile is not a function`.

Cause (a defect in Stage 2 + 3, not in the models or the translator): `routes/chat.js` imported the function `agentProfile` from
`services/agentProfiles.js`, but the request handler also destructures a field with the same name from the request body (the
prompt style: coder / writer / analyst). Inside the handler the body field hides the import, so `agentProfile(taskRoute.agentId)`
called a string or `undefined`. The error was thrown after the user message was saved and before any model call, so every chat
request failed, whatever the model or question.

Fix: the import is aliased (`agentProfile as agentById`); nothing else in the handler changed.

Why it was missed: the Stage 2 + 3 record above says `routes/chat.js` and `routes/orchestrate.js` were "syntax-checked and
statically scope-checked, not executed". That check looked for undefined names; it did not look for names that are declared twice
in nested scopes, which is what this was. The route had no test.

What now exists: `backend/tests/chatRoute.e2e.test.mjs` runs the real chat and translate routers with the real SQLite database,
the real session/auth code and a fake local Ollama (5 tests: a plain question, a request body that carries `agentProfile`, no
installed model gives the specific message, a document question goes to the Document Intelligence agent, translation falls
back to the local model). With the old `chat.js` three of them fail with exactly the production symptom; with the fix all pass.
The 80 tests available in the sandbox (not the repository's other test files, which were not copied there) pass against a copy of the backend with its real dependencies installed. An ESLint `no-shadow`
/ `no-undef` pass over every backend file changed in this work finds no other imported name hidden by a local one (it reports a
few harmless pre-existing loop-local shadows such as `answer` and `args`). Exploratory calls of the Windows, software-install,
image, orchestrator and models routes against the fake Ollama all returned normal events, no generic error; those calls are not
part of the shipped test because on a real Windows PC they could reach real system tools.

Still not verified: a real Ollama and the real models, the packaged EXE (it needs `build-exe.cmd`; an EXE built after Stage 2 + 3
and before this fix has the defect), and the desktop-control paths on Windows.

### Correction — "turn off location" was answered with instructions instead of being done (found and fixed 9 Oct 2026, night)

Symptom: asking the app to turn off location produced "Location services are currently enabled on your device. To change this
setting, please navigate to Settings > Location ... I cannot directly execute system commands", and nothing changed.
Cause: only some wordings were recognised as a Windows setting change (`settingsChangeTask` in
`orchestrator/ComputerTaskPolicy.js`). "turn off location services" was; "turn off location", "disable location", "turn off the
camera / webcam / gps", "location off pannu" were not (31 of 34 probed wordings missed). An unrecognised message takes the General
route, which has no tools by design, so the model could only explain. That is how the route policy is meant to work; the gap was
the wording list.
Fix: the loose privacy wordings are recognised, but only as a whole short command (`PRIVACY_COMMAND`), never inside a longer
sentence. For an unambiguous on/off command the backend now proposes the exact call itself:
`systemSettings.setConfirmed {id: location-access | camera-access, enabled: true|false}`, so it no longer depends on a small
model choosing to call a tool. "toggle location" has no direction and still goes to the model, which reads the current value. The
proposal is signed like every other computer action, `setConfirmed` still asks the person first (and Windows asks for
administrator rights where the setting needs it), and success is reported only when the result carries `verification: verified`.
Tests: `backend/tests/settingsRecognition.test.mjs` (4 tests; 28 wordings that must be taken, 16 ordinary sentences that must not,
such as "turn off the camera in zoom", "set location to Chennai", "how do I turn off location", "is location on?") and 5 more cases
in `backend/tests/chatRoute.e2e.test.mjs` (the route emits a signed `systemSettings_setConfirmed` tool_call without calling the
model; Tanglish and camera wording; the reply after the tool result is the tool's message only when verified, otherwise "has not
been verified"; no desktop tools gives "Execution blocked", not advice; ordinary sentences still go to the model). With the old
`ComputerTaskPolicy.js` four of the five new route tests fail. Those tests only check what the backend PROPOSES; the backend never
executes a tool, so they cannot change a setting on the machine that runs them. 89 tests pass in the sandbox.
Not verified: the Electron side that executes the call (the confirmation dialog, the UAC prompt, the registry write and the
read-back) was not run; it needs a Windows check on the real PC (turn location off, then look at Settings > Privacy > Location).
Known limits that remain: night light, do-not-disturb and battery-saver on/off are not in the settings catalog, so they cannot be
done by the settings tool. When the conversation has attachments, a request counts as a computer action only if it starts with
one of the verbs in `explicitAction` in `routes/chat.js` (turn, set, change, enable, disable, ...); "switch", "toggle", "block",
"allow" and Tanglish forms such as "location off pannu" do not, in that case. A running backend must be restarted (dev), or the
EXE rebuilt with `build-exe.cmd`, before any of this applies.
