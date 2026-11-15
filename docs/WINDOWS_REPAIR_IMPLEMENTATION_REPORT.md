# Windows Print Spooler Capability Implementation Report

Implementation review for the repository owner | 21 September 2026

Only windows.printSpooler.start.v1 was implemented. The application now separates read-only diagnosis, explicit human approval, one permitted start dispatch, and deterministic verification under AgentState. No second repair, model-generated repair script, automatic elevation, mutation retry, service-stop rollback, queue deletion, or driver change was added.

The automated application checks passed: 488 backend tests, 75 ToolEngine tests and 8 Electron checks. One live Windows integration test was skipped. The frontend production build passed with bundle-size warnings. This is not a production-readiness approval: the disposable Windows fixture matrix and protected installer execution remain release gates. No live Spooler mutation was performed on this computer.

## A Files changed

Paths below are relative to E:/chatbot. The workspace already contained Phase 1 through Phase 3 changes; those existing changes are not attributed wholesale to this implementation. No commit or reset was performed.

### Contracts and execution controller integration

- backend/src/orchestrator/WindowsRepairContract.js and frontend/tools/repair/contract.js: fixed capability identity, strict parameters, diagnosis eligibility, budgets, model allowlist and numeric verification predicates. A test prevents the packaged contract copies from drifting.
- backend/src/orchestrator/WindowsRepairCapability.js: fixed diagnosis, proposal, approved start and verification adapter. AgentState remains the controller; six admitted attempts maximum and zero retries.
- backend/src/orchestrator/ExecutionController.js: passes trusted session admission and current revision to the executor.
- backend/src/orchestrator/AgentExecutor.js: validates typed repair parameters and admission before bridge dispatch.
- backend/src/orchestrator/CapabilityContracts.js: registers the three supporting actions and deterministic verification contracts for this one repair.
- backend/src/orchestrator/AgentOrchestrator.js: routes Spooler intent and checkpoint continuation through the typed adapter.
- backend/src/orchestrator/LegacyExecutionAdapter.js: denies production model-generated PowerShell; dependency-injected legacy test fixtures remain available.
- backend/src/ai/Orchestrator.js and backend/src/agent/agentLoop.js: Auto Repair and API-agent adapters enter the same controller for Spooler intent; no shell fallback.
- backend/src/orchestrator/ToolEngineBridge.js: dedicated approval transport, repair timeout and durable confirmation cancellation.
- backend/src/orchestrator/ManualRecovery.js: machine-backed repair reconciliation, including ledger reconciliation of cancelled uncertain attempts without reopening terminal AgentState.
- backend/src/routes/orchestrate.js: owned recovery inspection and cancellation of inactive repair checkpoints and their outstanding approvals.

### Broker and protected execution

- frontend/tools/services/WindowsRepairService.js: owned immutable diagnosis, diagnosis-bound approval, precondition recheck, durable dispatch reservation, one mutation attempt, verification and reconciliation.
- frontend/tools/repair/RepairStore.js: versioned atomic journal and operation snapshots, corruption checks and write-before-dispatch behavior.
- frontend/tools/repair/PrintSpoolerRunner.ps1: fixed read-only inspection and verification plus one parameterless ServiceController.Start call targeting local Spooler.
- frontend/tools/repair/ProtectedRunner.js: fixed absolute executable, packaged-only runner, pinned bytes, protected path/owner/ACL/reparse checks, bounded output and helper deadlines.
- frontend/tools/repair/runnerDigest.js: approved runner byte digest.
- frontend/tools/repair/wireRepairLedger.js: shared, testable production renewal, reconciliation and cancellation wiring.
- frontend/tools/ConfirmationGate.js: diagnosis-limited expiry, bounded renewal and repair approval audit hooks.
- frontend/tools/ExecutionLedger.js: durable cancellation tombstones, trusted transport context and durable uncertain-result handling.
- frontend/tools/ToolEngineRouter.js: model policy enforcement, trusted approval continuation and filtered tool discovery.
- frontend/tools/services/ProcessService.js: allowed GUI launch targets resolve to fixed Windows system paths instead of PATH lookup.
- frontend/electron/ipc/toolBridgeServer.js: authenticated approval and confirmation cancellation endpoints; repair reconciliation uses broker evidence.
- frontend/electron/ipc/tool.ipc.js: protected runner and durable stores, shared repair ledger wiring and trusted human approval IPC.
- frontend/electron/preload.cjs: human confirmation uses the dedicated approval channel.

### Interface history and packaging

- frontend/src/services/chatExecution.js: prevents generic repair and model-confirmation escape paths in chat.
- frontend/src/services/api.js: owned repair inspection, resume, renewal and cancellation calls.
- frontend/src/stores/useAppStore.js: typed repair entry, checkpoint-bound approval and renewal, cancellation and truthful result display.
- backend/src/ai/TypedRepairProjection.js: versioned history projection retaining machine verification separately from user feedback; excludes raw approval tokens and runner commands.
- backend/src/ai/RepairLogger.js: typed history upsert, owned feedback and explicit typed export support alongside legacy records.
- backend/src/schemas/repairSessions.schema.json: separate typed and legacy schema branches, including existing ownership metadata.
- frontend/package.json: per-machine installer setting for a protected deployment location.
- frontend/scripts/afterPack.cjs: validates repair files in actual packaging output.
- frontend/scripts/validate-repair-package.cjs: package completeness, runner digest and single-start boundary checks.
- .gitattributes: fixes runner line endings so checkout conversion cannot silently change pinned bytes.

### Tests and report artifacts

- frontend/tools/tests/windowsRepair.test.js: 20 contract, policy, diagnosis, approval, durability, identity, cancellation, reconciliation, bridge and audit tests.
- frontend/tools/tests/repairPackaging.test.js: three artifact integrity, PowerShell syntax and packaging configuration checks.
- frontend/tools/tests/repairWindows.integration.test.js: opt-in disposable VM test through AgentState, approval, broker and protected runner; skipped here.
- frontend/tools/tests/executionLedger.test.js: existing synthetic manual-service fixture explicitly uses trusted internal operator context; production model policy remains enforced.
- backend/src/orchestrator/WindowsRepair.test.js: 13 controller, approval, failure, recovery, cancellation and no-replay tests.
- backend/src/orchestrator/WindowsRepairUI.test.js: checkpoint renewal, separate approval and decline behavior.
- backend/src/ai/TypedRepairProjection.test.js: three projection, ownership, feedback, export and schema compatibility checks.
- docs/WINDOWS_REPAIR_IMPLEMENTATION_REPORT.md and Chanakya_Windows_Repair_Implementation_Report.docx: this implementation report.

## B Final execution flow

User intent enters through chat, API agent, Auto Repair or the orchestrator. Spooler intent creates an owned AgentState session with task type windows_repair_print_spooler_start. The fixed adapter supplies typed steps; it does not ask a model to generate commands.

1. AgentState checkpoints act before read-only inspectSpooler. The authenticated bridge preserves requestId, toolCallId, idempotencyKey and session admission.
2. Diagnosis records host and boot identity, configuration hash, numeric status, startup mode, dependencies, stock configuration and actual query/start access. Eligible means stopped, automatic, stock local Spooler with required access and running dependencies.
3. startSpooler accepts only an owned diagnosisId UUID. Proposal obtains a durable confirmation bound to the exact diagnosis and logical operation. Approval warns that queued documents may print. No mutation occurs during proposal or renewal.
4. The trusted human continuation resumes the waiting checkpoint with the expected revision and matching token. Token consumption is durable. Fresh inspection must still match diagnosis.
5. The broker reserves sessionId plus capabilityId before dispatch. The protected helper repeats preconditions and contains exactly one Start call. No fallback, retry, escalation or automatic Stop exists.
6. A separate verifySpooler step obtains two fresh numeric Running observations at least one second apart, within the bounded verification window, with matching host, boot and configuration.
7. Only verified completion becomes done. The user-facing condition is: Print Spooler is running; printing has not been verified. resolved remains false and userIssueResolved remains null.

State flow uses existing legal transitions: idle -> plan -> act -> observe -> decide. Diagnosis then plans the proposal. Proposal leads to waiting_confirmation. Explicit approval leads to act -> observe -> decide, then a new plan for verification. Successful verification leads through verify to done. Known failure leads to error; cancellation leads to cancelled. An uncertain act remains unresolved and requires inspection and manual reconciliation. No replan is allowed because maxRetries is zero.

Before this phase, repair entry points could reach command-oriented legacy machinery. They now adapt to the same typed AgentState path. Existing utility implementations and old dataset records remain available internally; generic model-origin repair dispatch is denied.

## C Security and bypass tests

Passed tests cover strict UUID-only parameters, unknown keys/actions, missing admission, foreign diagnosis, foreign owner, stale checkpoint revision, ordinary model confirmation rejection and dedicated authenticated human approval. Unauthenticated loopback requests receive HTTP 401. A valid bridge secret alone does not bypass owner and session binding.

Generic model PowerShell, scripts, CMD/batch, service start/stop, arbitrary process launch and file-write escape paths are denied. Allowlisted GUI launches have fixed executable paths and no supplied arguments. The production legacy executor fails closed without invoking a model-generated command. Existing trusted-window IPC and navigation isolation tests also pass.

The helper runs only from a packaged protected installation, with matching pinned bytes. It checks ownership and write access of the path and ancestors and rejects reparse points. Development execution is refused. These are local trust boundaries; they do not defend against a compromised administrator, malicious trusted application code, or replacement of all protected application artifacts by an administrator.

## D Diagnosis tests

Passed tests exercise stopped eligible evidence, already-running classification, pending status, unsupported startup mode, changed configuration, missing start rights, stopped dependencies, wrong platform and malformed evidence. Diagnosis does not dispatch Start. Unknown or foreign diagnosis IDs and unsupported parameters cannot reach the runner.

The runtime diagnosis lasts at most 120 seconds. Renewing approval rechecks fresh evidence and rejects changed eligibility. Read-only diagnosis may fail because the service, CIM, local registry access, runtime or execution policy is unavailable; such failure never triggers another execution mechanism. Real Windows privilege and service-fixture coverage remains part of the VM release matrix.

## E Approval tests

Passed tests cover no start before approval, dedicated approval transport, owner/session checks, replay rejection, changed preconditions after consumption, spent-token replacement rejection and durable token renewal after restart. Tokens expire after at most 60 seconds and never beyond diagnosis expiry; at most three renewals are allowed. Renewal requires separate approval and does not execute.

UI coverage verifies that renewal updates the saved checkpoint revision and confirmation identity, then approval sends that revision and token. Decline cancels instead of resuming. Failed or expired approval does not authorize automatic rediagnosis or mutation.

## F Idempotency tests

The ToolEngine ledger preserves exact transport identities and caches completed results. The repair journal independently reserves one logical operation per session and capability. Concurrent continuations, reused tokens and distinct transport keys cannot dispatch a second Start. A reservation remains spent after uncertain results and restart.

Approval is consumed before precondition revalidation; failure cannot revive it. A consumed or cancelled lineage cannot mint a replacement proposal. A new repair session needs new diagnosis and approval. An unresolved reservation on the same host blocks another session until the earlier effect is reconciled.

## G Cancellation and recovery tests

Passed tests cover cancellation before dispatch across ledger restart, cancellation during an unresolved helper, late helper completion, refusal to review while execution is active, crash/disconnect uncertainty, manual completed/not_completed/abandon outcomes and recovery from a broker review persisted before checkpoint update.

Cancellation terminates the owned helper attempt; it cannot undo a start already accepted by Windows. The ledger continues to report executionActive until the dispatch promise settles. Uncertain effects cannot be automatically replayed. Manual completed review ignores user-supplied success data and requires fresh broker verification. not_completed does not authorize retry. Abandonment is terminal.

A cancelled uncertain repair can reconcile its effect ledger after quiescence without reopening or mutating its terminal AgentState. That closes a recovery gap while preserving the terminal-state contract. Operator confirmation of quiescence remains necessary after a process restart, when the new process cannot prove that an older helper is gone.

## H Deterministic verification and audit tests

Passed predicates require two matching numeric Running samples; a start return, a single sample, short interval, changed boot/configuration, string status or missing evidence cannot establish success. Failed verification never becomes done and never retries Start. Missing attribution stays unknown even when recovery establishes the running condition.

The broker journal carries version, event ID, global and session sequence, UTC time, session/revision, request/tool/idempotency identities, diagnosis, host/boot, capability/policy version, runner digest, effect status, evidence references and error/provenance fields. It records diagnosis, proposal, confirmation, precondition failure, reservation, start return, uncertainty, verification samples/results, cancellation request and reconciliation. Duplicate manual review preserves the original ledger evidence and does not duplicate the reconciliation event.

AgentState checkpoints remain authoritative for terminal transitions. The versioned history projection includes a stable session.completed or session.checkpoint event reference. Projection failures cannot be used as execution evidence; the broker ledger and checkpoint must be consulted. Journal corruption and persistence failure before dispatch fail closed. Feedback tests prove that a user saying printing still fails does not rewrite a verified service state. Typed training export describes only the scoped condition and never emits runner commands or approval secrets.

## I Windows integration test results

Not executed. The opt-in integration test was skipped because no disposable supported Windows VM with a protected installation and approved fixture was configured. The host identified during inspection is a Dell Inspiron 5570; a reported hypervisor alone is not evidence that it is a disposable VM. No Start, Stop, restart or queue mutation was performed here.

The added integration harness requires an explicit environment opt-in, checks a virtual-machine model and an empty Win32_PrintJob query, then exercises AgentState diagnosis, waiting confirmation, explicit approval and protected-runner verification. Fixture preparation and snapshot disposal remain external; the test deliberately does not stop Spooler as rollback.

Required release matrix still includes stopped/running/disabled fixtures, insufficient rights, execution-policy restrictions, native start errors, changed configuration, helper termination, reboot and a separately approved synthetic queued-document fixture. That broader matrix is not yet executed or fully automated. Mock tests cannot substitute for these results.

## J Packaging and integrity test results

Three automated checks passed: source and staged package integrity with tamper rejection; Windows PowerShell parsing without executing the runner; and per-machine packaging with actual-output validation wired into afterPack. Package validation now requires the repair broker modules as well as the pinned helper. Fixed line endings preserve the digest across checkout.

The frontend production build passed. No signed installer was built or installed, and protected-directory runtime ACL checks were not exercised inside a disposable deployment. The existing packaging scripts preserve and replace backend output/storage; this run did not exercise those installer operations. Signature policy, installation path/ACL inheritance, uninstall/update behavior and installed backend data-directory access remain release gates.

## K Full regression results

- Backend: npm test in backend; 488 passed, zero failed, zero skipped.
- ToolEngine: node --test frontend/tools/tests/*.test.js; 75 passed, zero failed, one Windows integration test skipped.
- Electron IPC trust: five passed using the real Electron runtime.
- Electron navigation guard: three passed using the real Electron runtime.
- Frontend: npm run build; passed with warnings about large chunks.
- Packaging checks were rerun after the final package-completeness adjustment: three passed.
- git diff --check: no whitespace errors; Git reported existing checkout line-ending notices.

The aggregate regression outcome is 571 passed checks and one skipped live integration test, plus a successful frontend build. Do not double-count focused reruns as additional independent coverage. Local evidence files are .spooler-backend.log, .spooler-tools.log, .spooler-ipc.log, .spooler-navigation.log and .spooler-build.log.

## L Remaining risks and release boundary

1. Production deployment is gated on the Windows fixture matrix and protected installer validation above. The development runner intentionally refuses execution.
2. Runtime stores assume one Electron broker and one backend session coordinator. Phase 3 multi-worker coordination remains a design boundary; no distributed lease or cross-process fencing was introduced.
3. The journal is an atomic local snapshot, not a tamper-proof append-only database. Same-user data modification, privileged tampering, disk corruption and long-term unbounded journal growth need operational controls. Checkpoint, approval and broker writes are separate; recovery fails closed rather than claiming cross-store transactions.
4. Human quiescence attestation is necessary after a crash. A running condition does not establish which actor started the service or whether any printer works. Cancellation can leave the service running and pending documents can print.
5. Protected installation may expose existing backend storage permission assumptions. Validate ordinary-user startup and writable data placement in the installed package before release; do not solve this by elevating the application automatically.
6. Runtime policy/ACL/helper failures currently fail closed, but native error reporting and policy-specific diagnostics need validation on supported Windows versions. No fallback is allowed when that validation fails.
7. History projection is a compatibility view rather than authoritative audit storage. Cancellation or manual review completed outside the normal drive loop can leave that view older than the checkpoint/ledger; recovery inspection must use those authoritative stores.
8. Expired diagnosis requires explicit cancellation/new session through the existing APIs; automatic linked-session creation is not implemented. No silent renewal of diagnosis or mutation retry is permitted.

The next work is validation and closure of these release gates for this same capability. Network repairs, driver changes, queue deletion, service restart/stop, generic PowerShell, privilege escalation and a second repair capability remain outside this phase.
