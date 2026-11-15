# Phase 3 Execution Recovery Report

Phase 3 implements the four follow-ups in the Phase 2 report: manual reconciliation, durable confirmation renewal, explicit application readiness checks, and a design for future worker coordination. AgentState remains the execution authority. The Phase 2 authenticated bridge, request identities, cancellation, idempotency, budgets, and terminal states remain in place.

## Inspection and prior behavior

The Phase 2 Word report was compared with AgentState, ExecutionController, CheckpointRecovery, ExecutionSessions, the checkpoint routes, ToolEngineBridge, ExecutionLedger, ConfirmationGate, the confirmation UI, ProcessService, and capability predicates. Uncertain calls blocked resume in act or observe. Confirmation tokens existed only in memory and expired after 60 seconds. A successful process spawn was enough for launch verification. Execution locks covered only one backend process.

## Architecture and state flow

Manual review and confirmation renewal are authenticated control operations, not model tools. The backend derives the action from the owned checkpoint and checks its revision. The existing session lock covers each operation. The loopback bridge authenticates the request before reaching Electron. Review writes durable ledger evidence; renewal writes durable token lineage. Neither operation dispatches the underlying action.

State transitions remain:

- Normal execution: idle → plan → act → observe → decide → verify → done or error.
- Completed manual review: unresolved act or observe → observe with reviewer evidence → decide. A separate explicit resume performs verification.
- Not-completed manual review: act or observe → observe with a failure result → decide. A separate resume may replan under the existing retry and step budgets.
- Abandonment: act or observe → observe → decide → cancelled. Recovery preserves cancellation if a crash interrupts the final transitions.
- Renewal: waiting_confirmation remains waiting_confirmation, with a new confirmation_renewed audit event. Step and retry counters do not change. Only explicit approval can move to act.

Terminal states remain terminal. Existing automatic results cannot be overwritten by a manual review.

## Manual reconciliation contract and workflow

1. GET /api/orchestrate/checkpoints/:id/recovery with the user's bearer session token. The response contains the checkpoint, ledger evidence, canReview, and the requirement for human confirmation that the original execution has stopped.
2. Inspect the original action and its actual effects. If the handler is still known to be running, the ledger rejects review even after its timeout returned an uncertain result.
3. POST /api/orchestrate/checkpoints/:id/reconcile with expectedRevision, requestId, idempotencyKey, toolCallId, and a review object. All identity values must match the current checkpoint attempt.
4. The review contains a unique reviewId, disposition (completed, not_completed, or abandon), quiescenceConfirmed set explicitly to true, and an evidence note of 10 to 4000 characters. A completed review also contains structured data that passes the existing capability predicate.
5. Inspect the returned checkpoint. Reconciliation itself executes no tool. For completed or not-completed work, POST the current revision to the existing resume endpoint when continuation is intended.

The ledger stores the review ID and hash, authenticated reviewer scope, timestamp, disposition, note, original call identity, and provenance set to human_attestation. Repeating the same ledger review returns the recorded evidence; changing it is rejected. A crash between ledger persistence and checkpoint persistence is recovered by the existing resume path. A repeated HTTP request with an old checkpoint revision returns 409, prompting inspection of the current checkpoint.

Manual completion is not presented as independent machine proof. The final verification scope is human_attestation when completion relies on a manual review. Humans can still be mistaken about side effects; the audit record makes that responsibility visible.

## Durable confirmation renewal

Electron persists confirmation metadata, root token ID, generation, previous token ID, expiry, and status in an atomic confirmation store. Approval marks the token consumed before dispatch. Cancellation and supersession are persisted. Store corruption or a persistence failure prevents approval.

POST /api/orchestrate/checkpoints/:id/confirmation/renew accepts expectedRevision and a unique renewalId. It requires the checkpoint to be waiting_confirmation. The old token becomes superseded and the replacement retains the original action, parameters, owner scope, and message. A repeated renewalId returns the same replacement, including after Electron restarts. Consumed, cancelled, foreign, and differently superseded tokens cannot renew.

The chat confirmation dialog includes “Renew request for a fresh approval.” Renewal keeps the same ExecutionController and toolCallId, replaces the displayed request, and leaves approval as a separate action. If persistence or transport fails, retry uses the same renewal ID. Chat history/checkpoint restoration across renderer restarts remains outside this phase; backend orchestrator renewal is the durable recovery path.

## Application readiness

ProcessService still launches through the existing schema, confirmation, and danger checks. After spawn, supported Windows GUI names receive a read-only tasklist probe for the exact child PID. Readiness requires a Running process status and an observed window title, while the tracked child has not exited. Polling has a three-second observation deadline; each native query has a 750 ms timeout. The probe honors cancellation and never relaunches the application.

The configured profiles cover notepad, calc, mspaint, explorer, chrome, firefox, msedge, winword, excel, vlc, spotify, discord, teams, zoom, code, wt, taskmgr, and control, including .exe names and Windows paths. A profile means a check is available, not a guarantee that every version will expose its window on the original PID.

The result includes readiness status, PID, criterion, and profile; ready results also include window title and observation time. Unsupported names/platforms report unsupported. An exited launcher or missing/unresponsive window reports not_ready. A PID alone no longer passes the orchestrator launch verifier. Tool transport success still records that spawning occurred; readiness is separate evidence. This does not prove an application's internal features are usable.

## Future worker coordination

PHASE3_WORKER_COORDINATION.md defines a transactional lease, revision compare-and-swap, monotonically increasing fencing tokens, a durable dispatch outbox, unique identity constraints, broker-side stale-token rejection, and cancellation tombstones. It also specifies takeover, renewal, review, and approval transactions and failure-injection deployment gates.

This is a design, not deployed multi-worker support. The current backend checkpoint files, confirmation store, and Electron ledger still require a single writer. A lease expiry in the future design is never treated as proof that an old side effect stopped.

## Files changed in Phase 3

Paths below are relative to E:/chatbot. Earlier uncommitted Phase 1 and Phase 2 changes remain separate from this inventory.

| File                                                   | Change                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| backend/src/orchestrator/AgentState.js                 | Adds the audited confirmation renewal event without changing execution budgets. |
| backend/src/orchestrator/ExecutionController.js        | Exposes renewal through the existing commit and checkpoint path.                |
| backend/src/orchestrator/AgentExecutor.js              | Reuses exact transport request construction for reconciliation identity.        |
| backend/src/orchestrator/AgentOrchestrator.js          | Preserves terminal abandonment when recovering a partially saved review.        |
| backend/src/orchestrator/CheckpointRecovery.js         | Carries review provenance and recovers abandonment consistently.                |
| backend/src/orchestrator/ManualRecovery.js             | New authenticated-owner review and renewal orchestration.                       |
| backend/src/orchestrator/DecisionEngine.js             | Stops work explicitly abandoned by manual review.                               |
| backend/src/orchestrator/ToolEngineBridge.js           | Adds authenticated reconciliation and renewal transport.                        |
| backend/src/orchestrator/CapabilityContracts.js        | Requires readiness evidence and labels human-attested verification.             |
| backend/src/orchestrator/ObservationHandler.js         | Preserves confirmation expiry in observations.                                  |
| backend/src/routes/orchestrate.js                      | Adds recovery inspection, manual review, and confirmation renewal endpoints.    |
| frontend/tools/ExecutionLedger.js                      | Adds durable review records and tracks unfinished handlers after timeout.       |
| frontend/tools/ConfirmationGate.js                     | Persists token lineage, consumption, cancellation, and idempotent renewal.      |
| frontend/tools/DurableConfirmationStore.js             | New atomic store with validation on restart.                                    |
| frontend/tools/ToolEngineRouter.js                     | Accepts the production confirmation storage location.                           |
| frontend/tools/BaseToolService.js                      | Persists original confirmation messages and returns expiry.                     |
| frontend/tools/ApplicationReadiness.js                 | New bounded native Windows window-readiness checks.                             |
| frontend/tools/services/ProcessService.js              | Adds readiness evidence after the existing spawn path.                          |
| frontend/electron/ipc/toolBridgeServer.js              | Exposes the two authenticated control operations.                               |
| frontend/electron/ipc/tool.ipc.js                      | Wires durable confirmations and trusted renewal IPC.                            |
| frontend/electron/preload.cjs                          | Exposes the restricted renewal method.                                          |
| frontend/src/stores/useAppStore.js                     | Preserves controller and renewal identity through fresh approval.               |
| frontend/src/components/ConfirmationModal.jsx          | Adds renewal control and visible renewal errors.                                |
| backend/src/orchestrator/Phase3.test.js                | Adds state, review, recovery, renewal, and readiness-verification tests.        |
| backend/src/orchestrator/Phase3Chat.test.js            | Adds chat renewal and separate-approval coverage.                               |
| backend/src/orchestrator/Phase2.test.js                | Updates the launch fixture to require Phase 3 readiness evidence.               |
| backend/src/routes/orchestrateRecovery.test.js         | Adds real HTTP ownership and control-flow coverage.                             |
| frontend/tools/tests/phase3.test.js                    | Adds durable gate, ledger, bridge, and readiness tests.                         |
| backend/src/orchestrator/PHASE3_WORKER_COORDINATION.md | Documents the future multi-worker protocol and deployment gates.                |
| docs/PHASE3_EXECUTION_RECOVERY.md                      | This implementation and operator report.                                        |

## Acceptance tests and results

New tests cover completed/not-completed/abandoned reviews, unchanged budgets during review, retry charging during explicit resume, foreign owners, stale revisions, wrong identities, conflicting reviews, immutable automatic results, live-handler rejection, and crash recovery at the ledger/observation/decision boundaries.

Confirmation tests cover expiry and restart, stable renewal replay, old-token rejection, consumed/cancelled/foreign-token rejection, persistence failure, malformed persisted records, checkpoint audit events, unchanged attempt history, and the requirement for a separate chat approval.

Readiness tests cover exact PID matching, responding window success, missing windows, early exit and handoff, unsupported applications, bounded failure, probe errors, cancellation, and rejection of PID-only success. These tests use controlled child/probe fixtures; a packaged live-GUI matrix was not run.

Validation completed on 19 September 2026:

- Backend regression suite: 471 passed, 0 failed, 0 skipped.
- ToolEngine regression suite: 52 passed, 0 failed, 0 skipped.
- Real Electron trusted-sender checks: 5 passed, 0 failed.
- Frontend production build: passed, with the existing bundle-size warning.
- Git whitespace check: passed; existing line-ending conversion warnings remain.

The change adds 26 Phase 3 tests across the backend, HTTP, chat, and ToolEngine suites. The total regression count is 528 passing tests including the Electron checks. No live repair commands or packaged application readiness matrix were exercised.

## Remaining risks and Windows Repair boundary

- Review after a process crash relies on a human establishing that the original action has stopped. Known live handlers are rejected, but external orphan processes cannot be disproved by a local in-memory tracker.
- Readiness currently depends on tasklist's English Running status and a window on the original PID. Localized output, brokered/UWP applications, launcher handoffs, and headless applications may remain unverified. No readiness failure automatically relaunches an application.
- Durable token, checkpoint, and ledger files are trusted local application data. Record retention and compaction are not implemented. Historical Phase 2 tokens issued before durable storage cannot be recovered from this new store.
- Multi-process coordination is design only. Production must remain single-writer until the transactional store and broker fencing protocol are implemented and tested.
- Manual reconciliation is an authenticated operator API workflow. The chat UI adds confirmation renewal; a general graphical checkpoint/reconciliation console is not part of Phase 3.

Phase 3 adds control-plane recovery and read-only launch observation. It adds no autonomous PowerShell commands, repair actions, privilege escalation, repair planning changes, rollback mechanism, or Windows Repair redesign. Future Windows Repair work must separately define allowed repair capabilities, preconditions, explicit approval policy, least privilege, postcondition evidence, rollback/compensation, and recovery for each repair operation. No approval to execute such repairs is implied by a reconciliation or confirmation renewal.
