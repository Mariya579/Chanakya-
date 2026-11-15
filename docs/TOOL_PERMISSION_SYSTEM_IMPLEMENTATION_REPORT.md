# Tool Permission and Execution Security Layer

Implementation date: 23 September 2026. Local changes only; no commit, push, cloud service, or Ollama endpoint change. The user subsequently authorized a Windows EXE rebuild; release validation is recorded in section 15.

## 1. Existing architecture found

The actual Windows execution boundary is `frontend/tools` in Electron's main process, not the backend. `AgentExecutor` sends typed requests through `ToolEngineBridge` to an authenticated, randomly bound loopback bridge. `ExecutionLedger` supplies cancellation, correlation, idempotency and durable evidence. `ToolEngineRouter` dispatches services, which retain their existing `InputValidator`, command guards and protected-target checks.

`AgentState` and `ExecutionController` already provide `act → observe → decide → waiting_confirmation → act → observe → verify`. Checkpoints bind continuation to the owner, current revision and matching confirmation. There is no need for a second workflow state machine.

`ConfirmationGate` already persisted expiring, consumable confirmations and renewal lineage. The Print Spooler capability adds owned diagnosis, expiry, configuration/machine checks, durable mutation reservation, fresh precondition inspection and independent verification. Production legacy model-generated PowerShell execution was already retired; its dependency-injected tests remain internal fixtures.

Authentication uses backend sessions, and Electron IPC checks the tracked WebContents. This change additionally verifies the current main-process session token against the existing local `/api/auth/me` endpoint before renderer execution, approval, renewal and cancellation. A window identifier alone is no longer treated as account identity.

Memory is already projected through separate short-term, task, system and long-term services. It has no approval-store or executor authority. No existing MCP server was found.

The repository contained extensive uncommitted implementation work before this task. The file lists below describe this task's edits; they do not attribute all of the working tree's changes to this implementation.

## 2. Files added

- `frontend/tools/security/ToolRegistry.js`: immutable definitions, explicit classifications and metadata validation.
- `frontend/tools/security/ToolRequestValidator.js`: strict envelopes, bounded schema checks and canonical parameter hashes.
- `frontend/tools/security/PathPolicy.js`: approved roots, component checks and sensitive-path policy.
- `frontend/tools/security/ToolPermissionPolicy.js`: deterministic allow/approval/deny decisions.
- `frontend/tools/security/ToolExecutionGuard.js`: final policy and exact approval revalidation.
- `frontend/tools/security/SecurityAudit.js`: explicitly projected, bounded in-memory and append-only disk audit events.
- `frontend/tools/security/ReadOnlyMcpServer.js`: local authenticated JSON-RPC read-only adapter.
- `frontend/tools/services/AppService.js`: typed application allowlist.
- `frontend/electron/services/ToolActor.js`: current authenticated renderer actor resolution.
- `frontend/tools/tests/toolPermissions.test.js`: registry, policy, files, approval, MCP, memory and AgentState tests.
- `frontend/tools/tests/toolActor.test.js`: renderer session identity tests.
- This report.

The security modules intentionally live beside the executing ToolEngine so Electron packaging includes them without importing backend source at runtime.

## 3. Files modified

- `frontend/tools/ToolEngineRouter.js`: policy admission, final guard, guarded confirmations, metadata and audit.
- `frontend/tools/ExecutionLedger.js`: authenticated scope, task identity and trusted transport context.
- `frontend/tools/ConfirmationGate.js`: exact authorization binding and validation.
- `frontend/tools/DurableConfirmationStore.js`: exclusive file lock and compare-and-swap persistence.
- `frontend/tools/services/FileService.js`: bounded creation and protected recursive enumeration.
- `frontend/tools/services/ProcessService.js`: registered execution resolves allowlisted apps from System32.
- `frontend/tools/repair/contract.js` and `backend/src/orchestrator/WindowsRepairContract.js`: matching model admission for bounded file operations and app opening; repair restrictions retained.
- `frontend/electron/ipc/tool.ipc.js`: roots, audit directory, verified renderer scope and registry wiring.
- `frontend/electron/ipc/toolBridgeServer.js`: authenticated `/mcp` endpoint.
- `backend/src/orchestrator/AgentExecutor.js`: forwards server-created task admission for ordinary steps as well as repairs.
- `backend/src/orchestrator/ToolEngineBridge.js`: removes anonymous `local-cli` execution-owner fallback.
- `backend/src/orchestrator/ObservationHandler.js`: safe permission/approval metadata.
- `backend/src/memory/TaskMemoryService.js`: context-only permission outcome projection, without tokens or parameters.
- `frontend/src/components/ConfirmationModal.jsx`: explicit risk context and “Allow once”.
- `frontend/src/stores/useAppStore.js`: approval metadata and valid enum schemas for model tool proposals.
- `frontend/tools/tests/executionLedger.test.js` and `frontend/tools/tests/toolEngine.security.test.js`: updated boundary fixtures and stable denial codes; original assertions about rejection, cancellation and exactly-once effects retained.

## 4. Final architecture

```text
User → local planner → typed proposal
  → authenticated backend bridge / trusted IPC + verified session
  → ExecutionLedger correlation and task context
  → registry + strict parameters + target policy
  → ALLOW / REQUIRE_APPROVAL / DENY
  → exact current approval, when required
  → final execution guard
  → existing typed service and existing lower-level checks
  → observation → AgentState → verification
  → safe audit and context-only task-memory projection
```

Unknown tools and missing classifications fail closed. Risk is explicitly assigned by application code, never inferred from model text or a service's `destructive` boolean. The boolean remains an additional compatibility check for existing dangerous service gates. Registry definitions are deep-frozen, including their schema. Adding an unclassified concrete service action fails registry construction.

The public dispatcher blocks arbitrary shell tools. Internal service functions remain available to application code and existing infrastructure tests; they are not new model capabilities.

## 5. Tool risk classification

Names follow the existing repository API. `TOOL_ENGINE` is the executor transport. The MCP adapter may additionally expose an explicit subset of READ definitions, setting effective transport in trusted server context. Registry transport `MCP` is supported and independently subject to the READ-only rule.

| Tools/actions                                                                                                                                                                                            | Registry risk           | Public transport / restrictions                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `hardware.systemInfo`, `cpuUsage`, `memoryUsage`, `diskInfo`, `gpuInfo`, `batteryInfo`, `networkAdapters`                                                                                                | READ                    | TOOL_ENGINE; existing model subset retained                                                                       |
| `network.ping`, `traceroute`, `dnsLookup`, `portScan`, `netstat`, `ipConfig`, `speedTest`                                                                                                                | READ                    | TOOL_ENGINE; existing model subset retained; typed bounds                                                         |
| `process.list`, `getProcess`                                                                                                                                                                             | READ                    | TOOL_ENGINE; `list` model-accessible                                                                              |
| `services.list`, `getStatus`                                                                                                                                                                             | READ                    | TOOL_ENGINE; typed service identifiers                                                                            |
| `file.readFile`, `listDir`, `fileInfo`, `searchFiles`                                                                                                                                                    | READ                    | TOOL_ENGINE; approved roots and sensitive-path filtering                                                          |
| `registry.getValue`, `listKeys`, `keyExists`                                                                                                                                                             | READ                    | TOOL_ENGINE; app-owned subtree only; not model-exposed                                                            |
| `powershell.getVersion`                                                                                                                                                                                  | READ                    | TOOL_ENGINE; internal/operator only                                                                               |
| `windowsRepair.inspectSpooler`, `verifySpooler`                                                                                                                                                          | READ                    | TOOL_ENGINE; typed owned repair task admission                                                                    |
| `file.createDirectory`                                                                                                                                                                                   | SAFE_WRITE              | TOOL_ENGINE; one new directory, no recursive parent creation                                                      |
| `file.createTextFile`                                                                                                                                                                                    | SAFE_WRITE              | TOOL_ENGINE; new `.txt`, `.md`, `.json`, `.csv`; exclusive create; 64 KiB character bound                         |
| `app.open`                                                                                                                                                                                               | SAFE_WRITE              | TOOL_ENGINE; Calculator, Notepad, Paint, Task Manager; no arguments; System32 resolution                          |
| `process.startProcess`                                                                                                                                                                                   | DANGEROUS               | TOOL_ENGINE; retained conservative approval behavior, allowlisted applications only                               |
| `process.kill`                                                                                                                                                                                           | DANGEROUS               | TOOL_ENGINE; existing protected-process checks; not model-exposed                                                 |
| `services.start`, `stop`, `restart`                                                                                                                                                                      | DANGEROUS               | TOOL_ENGINE; security-service targets denied; generic model repair remains unavailable                            |
| `file.deleteFile`, `copyFile`, `moveFile`                                                                                                                                                                | DANGEROUS               | TOOL_ENGINE; roots enforced; recursive deletion blocked; copies/moves limited to regular files; not model-exposed |
| `registry.deleteValue`                                                                                                                                                                                   | DANGEROUS               | TOOL_ENGINE; app-owned subtree and non-secret setting-name allowlist; not model-exposed                           |
| `windowsRepair.startSpooler`                                                                                                                                                                             | DANGEROUS               | TOOL_ENGINE; fresh diagnosis, approval and existing reservation/verification flow                                 |
| `file.open`                                                                                                                                                                                              | DANGEROUS               | BLOCKED public dispatcher; broad default-handler resolution replaced by typed `app.open`                          |
| `file.writeFile`, `registry.setValue`                                                                                                                                                                    | DANGEROUS               | BLOCKED public dispatcher; arbitrary content must not enter durable approval replay metadata                      |
| `powershell.execute`, `executeScript`, `cmd.execute`, `executeBatch`                                                                                                                                     | CRITICAL (conservative) | BLOCKED; arbitrary programs can perform critical operations                                                       |
| `disk.format`, `boot.modify`, `security.disableDefender`, `security.disableFirewall`, `storage.deletePartition`, `users.delete`, `credentials.reset`, `bitlocker.modify`, `domain.join`, `domain.remove` | CRITICAL                | BLOCKED definitions; no execution handler                                                                         |

Existing overwrite-capable copying remains DANGEROUS rather than being relabeled as reversible SAFE_WRITE. Network reset, driver changes and other absent capabilities remain unknown and denied; this implementation does not invent untested Windows repair handlers.

### File scope

Production READ roots: the application's `userData/tool-workspace` and Electron's resolved Documents folder. Production write root: `userData/tool-workspace` only. No model or IPC request can add roots. A missing root is not authority to expand scope. User-selected workspace administration is a future feature.

Checks reject traversal, UNC/device prefixes, environment expansion, short-name spellings, alternate data streams, reserved devices, trailing-dot/space spellings, Windows/Program Files/ProgramData targets, secret/credential path components, common credential databases and key extensions. Existing path components are checked with `lstat` and native `realpath`; symlinks/junctions, aliases and hard-linked files are denied. Recursive enumeration validates each descendant and skips protected entries.

## 6. MCP exposure

Authenticated local endpoint: the existing randomly bound loopback bridge plus `/mcp`. It uses the parent-process bridge secret and verified backend owner convention, not credentials supplied in tool arguments. It is not an unauthenticated public server.

Exposed reads:

- `hardware.systemInfo`, `hardware.cpuUsage`, `hardware.memoryUsage`, `hardware.diskInfo`, `hardware.networkAdapters`.
- `process.list`.
- `services.list`, `services.getStatus`.
- `network.ipConfig`, `network.ping`, `network.netstat`.
- `file.readFile`, `file.listDir`, `file.fileInfo`, `file.searchFiles`.

Implemented methods: `initialize`, `ping`, `tools/list`, `tools/call`, plus initialized notification acknowledgement. Calls use the same ledger and dispatcher. The adapter independently rejects non-READ definitions before dispatch, including a write accidentally registered with MCP transport. The policy repeats that check. MCP has no confirmation, mutation or policy-management method. Document RAG continues through its existing authenticated backend API; no redundant RAG tool was added.

## 7. Approval flow

1. A typed DANGEROUS proposal passes current policy and existing service validation.
2. The existing gate creates a random confirmation ID and durable record. Binding includes authenticated owner scope, task ID, tool, action, canonical sorted-JSON parameter hash and creation time. The record includes expiry and consumption state. Targets are included in the parameter hash.
3. The UI shows the existing action-specific impact message, risk and a single-use choice. There is no “Always allow”. The model cannot supply an approval boolean or authorization fields in a proposal.
4. Only the dedicated IPC approval operation or authenticated backend `/approve` continuation supplies trusted human-approval context. A model call to `_system.confirm` without that context fails.
5. The guard checks identity, exact parameters, current policy, capability availability, expiry and unused status.
6. Consumption is persisted synchronously before executing the handler. Exclusive store locking plus comparison against the current durable record prevents two independently loaded stores from consuming the same token.
7. Failure after consumption does not restore permission. Duplicate ledger identities return existing evidence; distinct identities cannot reuse the token.

Account changes alter renderer scope. Backend scopes derive from authenticated route ownership. Task identity uses server task admission or the execution controller's correlation namespace. Tokens created before this binding existed cannot authorize execution through the new guard; a fresh proposal/diagnosis is required.

Renewal retains the existing lineage rules and remains a request for another explicit approval. Repair renewal still rechecks current machine evidence and cannot extend diagnosis eligibility. A stale durable snapshot cannot overwrite a consumed/cancelled token.

## 8. Execution guard

The dispatcher checks the request envelope, current registry entry, authenticated actor/task, strict schema, target policy, effective transport, existing model capability restrictions and actual service availability. It evaluates policy again immediately before service admission, without an intervening asynchronous operation. Confirmation replays repeat these checks and validate the exact stored binding before consumption, then re-evaluate policy before invoking the existing confirmed handler.

Registry timeouts become cancellation signals passed into existing subprocess wrappers. Existing cancellation, protected-process/service/registry checks and Print Spooler preconditions remain enabled. Security audit persistence failure before admission prevents execution.

## 9. AgentState and frontend

No state names, checkpoint database or recovery model were replaced. Existing `needsConfirmation` envelopes pause in `waiting_confirmation`. Resumption remains owned, revision-checked and confirmation-specific. Verification follows the existing orchestration flow; repair success still requires current observations and the existing narrow postcondition, not a model's success claim.

Approval details survive observation normalization and reach the existing modal. The button is “Allow once”; blocked operations return stable policy reason codes/messages. SAFE_WRITE operations return normally without an approval modal. Legacy `process.startProcess` retains its existing approval behavior; `app.open` supplies the bounded automatic alternative.

## 10. Memory and audit boundary

Policy and guard never read memory. Text such as “User approved all service restarts” has no authority. Task memory receives only permission decision, risk and reason code, alongside existing contextual outcomes. It receives neither confirmation IDs nor authorization objects from this addition.

Audit events contain timestamp, actor scope, task/correlation ID, registered tool/action, risk, decision, stable reason code, result status, parameter hash where appropriate and a hashed approval reference. Requests, shell text, raw parameters, file content and tool output are not serialized into this audit. Production logs are in `userData/security-audit/tool-security.jsonl`.

Free-form content setters are blocked at the public dispatcher because their original durable replay design would otherwise persist arbitrary content in approval metadata. Internal functions and their existing unit tests remain; exposing such writes later requires a separate protected payload design. SAFE_WRITE creation does not create an approval payload.

## 11. Validation

Final validation evidence is retained in repository-root `.permission-*.log` files.

| Check                                                        | Result                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Complete backend `npm test`                                  | 517 passed, 0 failed                                                                          |
| ToolEngine `node --test frontend/tools/tests/*.test.js`      | 110 passed, 0 failed, 1 existing opt-in Windows VM test skipped (including release follow-up) |
| Frontend `npm run build`                                     | Passed; existing large-bundle warning remains                                                 |
| Electron IPC trust script under the actual Electron runtime  | 5/5 passed                                                                                    |
| Electron navigation script under the actual Electron runtime | 3/3 passed                                                                                    |
| Working-tree whitespace check                                | Passed                                                                                        |

The backend suite includes orchestration, AgentState/checkpoints, repair, authentication, memory, document RAG and translation coverage. The ToolEngine suite includes existing command guards, durable confirmations, repair packaging/integrity and mocked repair execution. New tests cover strict registry definitions, all four risk levels, approved-root writes, sensitive reads, junctions/hardlinks, parameter spoofing, account/task/action/target binding, expiry, replay, concurrent continuation, separate durable-store instances, post-consumption failure, capability changes, audit failure, MCP authentication/read execution/write rejection and AgentState pause/resume.

Initial regression failures were investigated: stable denial-code expectations and unregistered/unauthenticated synthetic fixtures were updated to the new contract; a real in-memory persistence test seam was repaired; the mirrored repair contract was synchronized. No rejection or replay assertions were removed. Electron scripts initially invoked with Node were rerun using their documented Electron runtime.

## 12. Known limitations

- The opt-in live Windows repair VM test was not enabled. No live Print Spooler mutation or installation into Windows was performed. The installer was rebuilt after user authorization; packaged runtime, backend, authentication and permission smoke checks passed using temporary data. This is not a live repair or installed-machine acceptance claim.
- Component checks and rechecks do not provide native handle-relative Windows filesystem operations. A hostile local process with write access to the same directories can race path replacement between validation and an asynchronous OS operation. Strong resistance to that adversary needs a native broker using pinned handles and reparse-point controls. This implementation does not claim that guarantee.
- Sensitive-path detection recognizes protected locations and common credential names; it cannot identify every secret placed in an otherwise ordinary user document. Approved-root policy remains essential.
- MCP is a small private local adapter, not a broadly interoperable SDK server. No third-party MCP client conformance or long-running streaming/session interoperability certification was performed. It adds no automatic client connection or cloud dependency.
- Generic model repair admission remains deliberately narrow. Adding risk metadata does not automatically expose registry edits, network resets, process termination or generic service mutation to Qwen. Fresh-diagnosis contracts must precede each future repair capability.
- There is no user-facing root-management screen. Automatic writes are limited to app-owned tool workspace; Documents is read-only.
- Audit files rotate at 5 MiB with five retained archives plus the current file. A disk-full condition fails closed at admission. Service outputs continue to use the repository's existing execution ledger, separate from the new metadata-only security audit.
- Internal service methods are application implementation APIs, not independent authenticated public endpoints. Code running inside the Electron main process is trusted; a compromise of that process or its bridge secret is outside this policy's protection.

## 13. Remaining risks and recovery

The Electron process remains the normal single broker, enforced by its existing single-instance lock. Cross-process compare-and-swap protects approval consumption, but this does not convert the whole execution ledger and repair journal into a distributed multi-worker system.

An abrupt process death while holding `confirmations.json.lock` intentionally leaves future approval writes blocked. Recovery must establish that no broker is running, preserve the store/journal for review, inspect uncertain effects and only then remove the abandoned lock. There is no automatic stale-lock takeover or automatic replay.

Account authentication is revalidated through the existing fixed loopback backend address used by this application. This assumes the managed backend and trusted main process remain intact. The implementation does not claim protection from a local administrator replacing either process or its files.

Cancellation cannot undo an OS mutation already admitted. Spooler operations retain the original uncertain-effect and reconciliation rules. Approvals remain spent after failures, timeout and uncertain completion.

## 14. Recommended next phase

1. Run the opt-in Windows VM repair acceptance test and installed-package validation in a disposable, controlled environment.
2. Add native handle-based filesystem execution before claiming protection against hostile concurrent local filesystem mutation.
3. Add explicit user-selected root management and a protected non-replayable payload store before exposing arbitrary content updates.
4. Add a supervised abandoned-lock recovery interface; bounded audit-log retention is now implemented and tested.
5. Validate the private MCP adapter against intended local clients before widening its protocol surface; retain independent server-side READ-only enforcement.
6. Expand repair capabilities one at a time with typed diagnosis, action-specific approval, reservation, verification and recovery contracts. Keep CRITICAL blocked.

## 15. Authorized clean Windows release follow-up

The follow-up request authorized rebuilding the EXE and reviewing outstanding coverage. The review added bounded audit retention and release validation, and found that the legacy packaging path restores old accounts/uploads into the package. The new `npm run electron:release` path sets clean packaging mode and uses a separate `frontend/release-security` output. It never copies the prior package's storage into the installer and leaves the previous `frontend/release-build` data untouched.

Release support added:

- `frontend/scripts/build-release.cjs`: pinned local Electron verification, offline reuse of matching isolated backend dependencies, native-module smoke checks, frontend build, clean NSIS output and post-package validation.
- `frontend/scripts/validate-security-package.cjs`: compares 21 packaged security/backend files against source hashes and rejects bundled user storage.
- `frontend/scripts/smoke-security-release.cjs`: exercises the actual packaged EXE in Node mode, with a temporary database and ephemeral local ports.
- `frontend/tools/tests/securityRelease.test.js`: audit rotation and retained metadata checks.
- `prepare-backend.cjs` and `afterPack.cjs`: clean-release mode and checks that destructive build paths stay inside intended build directories.
- `frontend/package.json`: clean release command and the verified installed Electron distribution path; `.gitignore` excludes the generated release folder.

The installed Electron distribution matches the pinned 37.10.3 version. Both better-sqlite3 and LanceDB loaded successfully using that runtime before packaging. No new runtime internet requirement was introduced.

Packaged smoke checks passed: backend import/migrations, unauthenticated request rejection, authenticated registration/session lookup, bounded file creation, file reading, CRITICAL rejection, arbitrary-shell rejection, unknown-tool rejection, MCP authentication and MCP reading. All smoke data belongs to a synthetic temporary test database; no real account or machine repair was used.

Coverage remains explicit: all requested deterministic enforcement categories have implemented checks or fail-closed restrictions, and the full automated regression suites pass. Native handle-relative filesystem protection, a disposable-VM live repair test, third-party MCP conformance and installed-machine acceptance have **not** been claimed as completed. The safety limits in sections 12–14 still apply; a rebuilt installer does not remove them.

Build and test evidence: `.release-build.log`, `.release-backend-tests.log`, `.release-tool-tests.log`, `.release-smoke.log`, `.release-ipc.log` and `.release-navigation.log`. Release output and checksums are recorded beside the completed installer.
