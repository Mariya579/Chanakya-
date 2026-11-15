# Windows Repair Capability Design

Design for approval | 20 September 2026

The proposed first repair is windows.printSpooler.start.v1: start the local Print Spooler only when diagnosis shows that it is stopped and eligible to start. This is one narrowly scoped mutation, supported by read-only diagnosis and verification. It does not restart a running service, clear print jobs, change service configuration, install drivers, or print a test page. Pending documents may print when the service starts, so the action always requires explicit approval.

This report defines the implementation contract and acceptance tests. No application code, repair commands, training data, or service configuration has been changed in this design phase. No repair has been executed. Implementation is pending user approval.

## Existing implementation and concrete gaps

The Auto Repair entry is frontend/src/stores/useAppStore.js, through _streamAutoRepair and apiService.streamRepair. POST /api/repair authenticates the user and streams NDJSON. backend/src/ai/Orchestrator.js classifies the intent, loads a domain guide, creates an advisory plan, selects a specialized BaseAgent, analyzes the outcome, and logs the session.

BaseAgent.run delegates to LegacyExecutionAdapter. This adapter already uses ExecutionController and AgentState for transitions, budgets, observations, cancellation, and checkpoints. Its actual execution callback still classifies a model-generated command and invokes backend/src/agent/powershellRunner.js directly. Both read and fix classifications execute without an interactive approval step. This path does not use the Electron execution ledger, durable confirmation gate, or authenticated ToolEngine bridge. A shared controller does not by itself make these execution boundaries equivalent.

The separate Electron path is ToolEngineRouter -> BaseToolService -> PowerShellService, CmdService, or another service. PowerShell and CMD actions require confirmation and repeat the dangerGuard check at execution. ToolEngineRouter's confirmation continuation retrieves stored parameters rather than accepting replacement parameters. Phase 2 and Phase 3 add bridge authentication, ownership, durable execution identities, cancellation, recovery, and confirmation renewal around this path.

Concrete findings that affect this design:

- dangerClassifier uses a command-text allowlist and block patterns. ipconfig /flushdns is explicitly tested as read, although it changes resolver state. Unknown unblocked commands default to fix and can execute through the legacy adapter. This classifier cannot be the authorization boundary for the new capability.
- PowerShellService.executeScript and CmdService.executeBatch apply the content block check only when content.length is at most MAX_SCRIPT_CHECK_BYTES. Larger scripts skip that check. Files are also checked before a later path-based execution, leaving a replacement window. These are existing risks, not changes made in this phase; the new capability must never delegate to either generic script action.
- Shell and service runners accumulate output before truncating returned text. Their current limits are not hard in-memory streaming limits. The new runner must cap bytes during collection.
- WinServicesService.start accepts a general service name, invokes Start-Service, and then queries status. It has confirmation but no repair-specific diagnosis binding, single-target policy, fresh approval preconditions, or stability predicate. It is not sufficient as the repair contract.
- ResultAnalyzer obtains resolved from an LLM. The repair orchestrator prevents a stopped execution from becoming successful, but successful command execution is still not deterministic proof that a printing problem was fixed.
- The Auto Repair UI renders thought, command, output, blocked, and final events. It does not currently provide the typed repair confirmation and checkpoint recovery experience required here. Its blocked label suggests approval is possible even though that event itself contains no resumable confirmation token.
- CheckpointRecovery currently resumes only mode orchestrator; legacy auto-repair checkpoints are not replayable through that API. The new repair must use mode orchestrator with a repair task type, preserving the existing controller rather than creating a new loop.

## Guides and dataset inspection

Repair guides are cached Markdown loaded by knowledge/index.js and inserted into the model prompt; they are advisory text, not executable permission definitions. The Windows guide includes Restart-Service Spooler -Force, Start-Service <name>, print-job deletion, startup changes, Windows Update cache changes, SFC and DISM. Other guides include adapter resets, DNS changes, device toggles, recursive temporary-file deletion, ownership changes, and security-setting changes. None of those operations is included merely because a guide recommends it.

RepairLogger writes completed session arrays under backend/storage/training-data/repair-sessions.json and exports conversational JSONL. The inspected session file contains 1558 records. A sampled record contains id, createdAt, goal, domain, subdomain, plan, steps, resolved, summary, recommendation, and feedback. Steps contain command, blocked, exitCode, stdout, stderr, and reason. The JSONL sample contains messages with system, user, and assistant roles; it is not an execution journal.

Current logging truncates outputs, omits timedOut and stable tool identities, rewrites a whole JSON array, and catches write errors. It cannot be the authoritative recovery log. The runtime now writes userId, but repairSessions.schema.json has additionalProperties false and does not declare userId: the schema and writer need a compatible alignment when typed repair records are introduced. Existing records and exports must remain readable.

The proposed audit journal remains separate from training exports. A versioned projection can later include capability, diagnosis, consent, machine verification, uncertain outcomes, and user feedback as distinct fields. A user saying that printing worked must never rewrite the machine verification record. New typed records must not be silently discarded by the current command-based quality filter, nor exported as raw PowerShell instructions.

## A User intent and scope

Example intent: My printer is not printing. Check whether the Print Spooler is stopped and offer to start it.

The model may propose this capability after read-only diagnosis. It cannot declare the root cause, choose another service, or supply command text. A stopped Spooler is a repairable service condition, not proof that it is the only cause of the user's printing problem. If Spooler is already running, report that condition and do not restart it. If disabled or otherwise ineligible, explain the finding and stop this repair path.

Risk classification: limited-scope, approval-required system mutation. Starting Spooler can activate printing and the service's normal network behavior. It is not presented as harmless or fully reversible.

## B Diagnosis steps

1. Create an owned AgentState session with mode orchestrator and taskType windows_repair_print_spooler_start. Diagnosis is a recorded read-only attempt, not an implicit mutation.
2. Read local Windows platform/build identity, machine identity and boot identity, capability policy version, runner version, and actual service query/start access under the current execution token. Do not change privileges or ACLs.
3. Inspect exactly Spooler using fixed service APIs: existence, numeric status, startup type, service account, configured binary path, dependency names and current states, and native status/error fields. Do not read document names, spool-file contents, or broad event logs.
4. Validate the stock service configuration against the supported workstation profile. Version 1 requires automatic startup, LocalSystem, the expected local System32 spoolsv.exe configuration, and dependencies already running. Unknown/custom configurations, disabled/manual startup, or unavailable evidence are ineligible.
5. Persist an immutable diagnosis with a UUID, owner/session/host/boot binding, configuration fingerprint, observations, source, policy version, capture time, expiry, and eligibility reasons. Return this evidence to the user before requesting approval.

Diagnosis has a 10-second deadline and a bounded output contract. A failure to read or validate a field is unknown, never assumed eligible. Eligibility lasts at most 120 seconds and is rechecked immediately before mutation. Reboot, policy/runner update, or material configuration change invalidates it.

## C Typed capability and allowed parameters

There is exactly one mutation capability. Its public tool envelope is:

```json
{
  "tool": "windowsRepair",
  "action": "startSpooler",
  "params": { "diagnosisId": "<owned diagnosis UUID>" }
}
```

The corresponding capability ID is windows.printSpooler.start.v1. The parameter schema is:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["diagnosisId"],
  "properties": {
    "diagnosisId": { "type": "string", "format": "uuid" }
  }
}
```

UUID validation must be enforced, not merely documented as a format annotation. Validate a plain own-property object, reject prototype keys, unknown fields, null, arrays, coercion, missing fields, oversized input, and unsupported versions. The ID must resolve to this authenticated owner's current session and host. A syntactically valid invented UUID grants no authority.

There are no user/model parameters for service name, host, command, script path, arguments, force, timeout, retries, privilege, startup type, or verification logic. Target Spooler and all limits are immutable implementation policy. Read-only inspectSpooler and verifySpooler operations support this one repair; neither may mutate anything.

Trusted execution metadata remains outside params: sessionId, checkpoint revision, owner scope, host/boot identity, capability and policy version, exact toolCallId, requestId, idempotencyKey, diagnosis digest, approval lineage, and logical operationKey. The model cannot supply or override it. Transport calls retain Phase 2 identities; the logical operationKey is stable across renewal and confirmation continuation so a replacement token cannot create a second start attempt.

## D Preconditions and privilege requirements

Before offering approval, all required diagnosis fields must be valid and the service must be stopped. Immediately before the start, the broker repeats status, configuration, dependency, access, cancellation, and policy checks against the approved diagnosis. If the service is now running, return already_satisfied without mutation and verify it. If it is pending, paused, absent, disabled, manually configured, changed, or unreadable, stop with a structured reason and no repair fallback.

Version 1 requests only local service query/configuration access and SERVICE_START for Spooler. Windows ACLs determine the actual access; administrator group membership alone is not proof that the current token is authorized. No UAC launch, credential collection, ACL edits, scheduled task, persistent service installation, or automatic restart of Electron/backend as administrator is allowed. Insufficient rights produce PRIVILEGE_REQUIRED. Broader elevation support requires a separate design. See Microsoft Service Security and Access Rights.

Persisted configuration checks reduce stale approvals but cannot atomically exclude outside administrators or Service Control Manager dependency activity. Windows may start dependencies as part of starting a service. Requiring dependencies to be running reduces that possibility, but the approval must disclose it and the implementation must not promise a system-wide atomic snapshot. No dependency is explicitly started by this capability.

## E Approval requirement and renewal

Every actual start requires a fresh affirmative user action through the trusted confirmation channel, even in Auto Repair mode. Model output, guide text, prior conversation consent, a tool-call flag, or a GET/inspection request cannot approve execution.

Proposed approval text: Start the local Print Spooler? It is currently stopped. Existing queued documents may print, and Windows may activate configured dependencies. This action will not clear jobs or change startup settings. Stopping this request after Windows accepts it may not stop the service. Printing itself will still need to be checked.

Persist approval binding to the exact capability/version, target, parameters, diagnosis/configuration digest, host/boot, owner/session, operationKey, and confirmation lineage. Preserve Phase 3 durable token consumption, cancellation, and supersession. A 60-second token cannot outlive diagnosis eligibility. Renewal is not approval and never dispatches work. Same renewal ID returns the same token; approval still rechecks the preconditions.

If diagnosis has expired or materially changed, renewal returns REQUIRES_REDIAGNOSIS. Do not silently attach new evidence to an old approval. Close the old waiting session with an audited error and start a linked diagnosis session on explicit user continuation; this respects the existing waiting_confirmation transition rules. Consumed or cancelled tokens stay invalid. Only the trusted human approval endpoint/IPC path may consume a token; _system.confirm must not be exposed as a model-authorized action.

## F Execution boundary and AgentState flow

Proposed flow: UI or API intent -> owned orchestrator session -> read-only diagnosis -> typed proposal -> durable confirmation -> authenticated ToolEngine bridge -> execution ledger -> capability policy gate -> WindowsRepairService -> fixed packaged runner -> structured observation -> separate read-only verification -> deterministic verdict.

Use the existing AgentState graph without adding a repair state machine. Diagnosis and verification are normal bounded attempts. A normal path is idle -> plan -> act -> observe -> decide; the proposal attempt then reaches waiting_confirmation. Approval continues waiting_confirmation -> act -> observe -> decide. The verification attempt returns through observe and decide, and verify -> done is permitted only when the deterministic capability predicate passes. All failures use existing error/cancelled terminals or the existing unresolved act/observe recovery condition. There is no new phase named uncertain.

Proposed fixed limits: maxSteps 6, maxRetries 0, one mutation dispatch per logical operation, at most three confirmation renewals. The usual path consumes four attempts: diagnosis, approval request, approved execution, verification. Observation polling is a bounded tool implementation detail; it cannot plan, retry a mutation, or call other tools. Insufficient budget before approval or verification stops the session truthfully.

WindowsRepairService must not call PowerShellService.execute, executeScript, CmdService, or general WinServicesService.start. It uses ExecutionContext to launch a fixed, packaged, integrity-checked runner through the absolute Windows PowerShell executable with NoProfile, NonInteractive, and File arguments. The script path and its operation enum are internal constants; no model text is interpolated or evaluated. Do not add ExecutionPolicy Bypass. A policy/signature restriction yields POLICY_BLOCKED, not a workaround.

The runner contains reviewed fixed code using local service APIs through .NET ServiceController, with Spooler hard-coded. Its only mutating operation is one parameterless Start call. Inspection and verification use freshly refreshed numeric service status and fixed configuration queries. The artifact must be signed or otherwise integrity-pinned and installed in a protected location; writable development scripts are not an acceptable elevated deployment boundary. Reject a missing/modified runner or unsupported runtime instead of falling back to free-form commands.

Bound the start helper to 35 seconds, verification to 15 seconds, and each captured stream to 64 KiB while reading. Oversized, malformed, truncated, wrong-identity, or extra output fails validation. Cancellation or timeout kills only the owned helper and never spoolsv.exe. A blocked native call may already have reached Windows; helper termination is not proof that the effect was undone. Start acceptance is not readiness. Microsoft documents that service startup returns before initialization is necessarily complete.

## Preventing capability bypass

The capability registry and broker policy are enforced at dispatch, not solely in prompts or tool discovery. A backend-issued admission record binds the owned AgentState attempt and its allowed capability set to the bridge request. The renderer and model cannot mint a trusted mode, approval, owner, or bypass flag. Electron validates the admission binding before dispatch and again on confirmation continuation. Existing per-session bridge authentication remains mandatory; it is transport authentication, not a substitute for capability authorization.

Model-originated repair execution must fail closed for legacy-powershell, powershell.execute/executeScript, cmd.execute/executeBatch, general service mutation, arbitrary process launch, script execution via another tool, and unknown capabilities. Remove those from model-visible repair tools and also reject forged direct calls. The API agent, Auto Repair, and chat repair handoff must converge on the same policy; an unsupported repair cannot fall back to BaseAgent's raw-command loop. Broad process.startProcess is not a safe escape route for launching a shell.

Enforce this boundary by trusted execution origin, not the model's claimed intent or mode. All model-originated sessions must reject generic shell/script execution and unrestricted executable launches; otherwise a repair could be relabeled as ordinary chat to evade the policy. Normal chat can retain explicitly allowlisted application-launch profiles and safe capabilities. User-entered command text must not become an operator-authorized command merely because the model repeats it.

Existing generic services and legacy handlers may remain available in source for compatibility or an explicitly separate manual operator workflow. They cannot remain an automatically reachable model fallback. Ordinary chat remains a mode; a proposed repair opens the same authoritative repair session. This is an intentional execution-policy restriction to satisfy the no-bypass requirement, not removal of the underlying utilities. If a retained generic model path can still execute this repair through a shell or arbitrary executable, the capability must not be considered ready to ship.

The trust boundary assumes the installed application and local operating system are not compromised. The session secret does not protect against a malicious local administrator, tampered executable, or arbitrary code already running with the broker's privileges. Multi-worker operation remains unsupported under the Phase 3 single-writer constraint.

## G Deterministic postcondition and truthful results

After the start attempt, a separate read-only verification operation must observe Spooler as SERVICE_RUNNING in two fresh samples at least one second apart, within the 15-second verification deadline. Both samples must identify the same host, boot, service and configuration profile; a intervening non-running status resets the pair within the fixed deadline. A failed read never counts as a sample. The verifier consumes broker-persisted observations, not model-supplied JSON or a translated success sentence.

Return a typed result with outcome started_verified, already_satisfied, failed, or uncertain; startDisposition accepted, not_dispatched, rejected, or unknown; verificationScope service_running; verificationStatus passed, failed, or unknown; diagnosisId; before/after evidence references; nativeErrorCode; and exact execution identities. Set userIssueResolved to null unless separately collected user feedback confirms printing. The UI says Print Spooler is running; printing has not been verified. It must not say Printer fixed.

Service status is evidence of the state Windows reports, not a guarantee that a driver, printer, or queued document works. Recovery can establish that the target condition is currently satisfied without proving which actor started it. Preserve attribution as unknown when start evidence is missing. The native status API itself reports the latest SCM state, which can lag a state change; repeated fresh samples reduce but cannot eliminate that limitation.

## H Failure handling and compensation

Invalid parameters, missing/foreign diagnosis, stale revision, expired approval, changed configuration, missing access, or cancelled admission cause zero mutation dispatches. No LLM replan into another repair is permitted. A definitive native rejection records its code and final read-only evidence, then ends this capability. A timeout, disconnect after admission, malformed result, or failed persistence after possible dispatch is uncertain; do not label it not_started.

If the service remains stopped, becomes pending beyond the deadline, or exits after starting, verification fails or remains unknown. Do not restart, clear queues, kill processes, change settings, or retry Start. Display the native error and diagnostic evidence and require a new reviewed session for any further repair.

Rollback is not safely automatic. Stopping the service could interrupt other work and cannot undo documents already printed. This capability never stops Spooler as compensation. Recovery consists of preserving evidence, observing current state, reporting the remaining uncertainty, and handing off to an operator. A future stop/restore capability would require a separate policy and approval and is outside this design.

## I Cancellation and recovery

Before dispatch, cancellation is durably recorded and checked at both admission and the final pre-start boundary. Waiting confirmation is invalidated. After dispatch, cancellation is propagated by requestId to the ledger and owned helper. AgentState remains terminal cancelled if cancellation wins; later success evidence cannot reopen it. The UI distinguishes execution cancelled from operating-system effect possibly completed.

A new explicitly requested inspection session can observe effects of a terminal cancelled/error session without resuming or rewriting it. For a nonterminal act/observe checkpoint, the existing owner/revision checks and session lock apply. Read the ledger first. Completed matching evidence can be consumed without replay. An unknown, running, or uncertain record cannot trigger another Start.

Before allowing manual resolution, prove the old helper has exited or have an authorized operator establish quiescence, as Phase 3 requires. A bounded read-only service inspection may establish the current desired state; it cannot prove that a start never occurred. Keep historical attribution unknown unless durable evidence resolves it. Pending or inaccessible state remains unresolved. Do not infer non-execution from an expired lease or an absent process after a crash.

For this capability, a manual completed review must reference fresh broker-recorded service samples and retain human_attestation provenance. User-submitted data claiming Running is not machine verification. A not_completed review cannot authorize automatic replan or dispatch under a new confirmation ID; maxRetries remains zero and the logical operationKey stays spent. A later attempt requires a new session, diagnosis and explicit approval after the uncertain earlier attempt is reconciled. Abandonment uses the existing cancelled terminal.

On crash between approval consumption and start/result persistence, the token remains consumed and recovery never renews it to replay. Renewing an unconsumed approval retains the same immutable diagnosis and operation binding; expiry requires re-diagnosis. The ledger must persist the operation reservation before helper spawn and completion evidence before reporting success. Storage failure before reservation means no start; storage failure afterward means uncertainty, not a silent retry.

## Audit and event format

Use a versioned structured event journal linked to existing AgentState checkpoints and the ToolEngine ledger. Persist before-dispatch reservation and approval evidence before mutation. Use monotonically ordered sequence numbers within the session and event IDs for deduplication. UTC timestamps aid review; monotonic elapsed times determine deadlines. Keep full audit evidence local and access-controlled; stream only an appropriate projection to the UI.

Required event fields: schemaVersion, eventId, sequence, eventType, timestamp, sessionId, admittedStateRevision, attemptId, ownerId, hostId, bootId, capabilityId, capabilityVersion, policyVersion, runnerDigest, operationKey, toolCallId, requestId, idempotencyKey, diagnosisId, approvalRootId, approvalGeneration, effectStatus, evidenceRefs, errorCode, nativeErrorCode, and provenance. Nullable fields are explicit before their stage exists. Never log bridge secrets, reusable approval tokens, credentials, print-document names, or document contents.

Event types include diagnosis.completed, repair.proposed, confirmation.requested/renewed/approved/rejected, repair.precondition_failed, repair.dispatch_reserved, repair.start_returned, repair.effect_uncertain, verification.sample/result, cancellation.requested/acknowledged, reconciliation.recorded, and session.completed. These describe events, not additional AgentState phases. Result, review, and state revision linkage must survive a crash and replay with the same event IDs. A sequence/hash chain may detect some corruption; it does not make local files tamper-proof.

Example final event payload, shown as a contract rather than an observed execution:

```json
{
  "eventType": "verification.result",
  "capabilityId": "windows.printSpooler.start.v1",
  "effectStatus": "started_verified",
  "verification": {
    "predicate": "spooler_running_two_samples_v1",
    "status": "passed",
    "scope": "service_running",
    "sampleRefs": ["<sample-1>", "<sample-2>"]
  },
  "userIssueResolved": null,
  "provenance": "machine_observation"
}
```

## J Acceptance tests before release

These are proposed tests, not results. No new repair implementation exists yet and no live service tests were run during this design phase.

1. Schema tests: exact capability/version, required owned diagnosis UUID, all unknown keys and command/script/host/force fields rejected, no coercion or prototype pollution. Invalid input yields no spawn.
2. Diagnosis tests: stopped/automatic/stock configuration eligible; running produces no-op advice; absent, disabled, manual, pending, changed, unknown, foreign-host, stale and unreadable evidence rejected. Diagnosis never mutates.
3. Privilege tests: actual query/start access, filtered token, access denied, and policy-blocked runner; no elevation or privilege-edit attempt occurs.
4. Approval tests: no approval means no start; tampered params or diagnosis, foreign owner, expired/replayed/consumed/cancelled token fail; renewal persists after restart and requires fresh approval; stale diagnosis requires a linked new session.
5. Boundary tests: one hard-coded target and zero service arguments; fixed protected runner/executable; modified runner refused; direct shell/CMD/script/general-service/arbitrary-launch/model-confirm attempts blocked across chat, API agent, Auto Repair and forged broker calls.
6. Determinism tests: start return alone cannot succeed; two fresh running samples pass; one sample, stale/mismatched evidence, running-then-stopped, malformed output and query errors fail. Model text and user-supplied Running data cannot override verification.
7. Cancellation tests: before admission, while waiting, after token consumption, during native call, during verification, and after a late result. No automatic stop or terminal-state resurrection; effects may remain uncertain.
8. Idempotency tests: duplicate/concurrent HTTP requests, confirmation replay, renewed token, and new transport key for the same operation produce at most one start dispatch. Parameter/identity conflicts are rejected.
9. Recovery tests: inject crashes before reservation, after reservation/before spawn, after token consumption, after OS acceptance, after evidence save/before checkpoint save, and during manual review. Resume never blindly starts; known live helper blocks review; unknown attribution is preserved.
10. Budget and state tests: every legal controller transition, invalid transitions, maxSteps exhaustion, maxRetries zero, renewal cap, deadlines and streaming byte limits. No failed verification enters done and no hidden replan issues another repair.
11. Audit tests: disk-full/write-failure, corrupted record, duplicate event delivery, owner isolation, complete identity linkage, secret redaction and schema-version handling. Feedback remains separate from verification; old dataset/session shapes stay readable.
12. Windows integration tests: disposable supported Windows workstations with controlled print queues, stopped/running/disabled service fixtures, non-admin access, changed configuration, native start failure and helper termination. Include a queued-job fixture to demonstrate the disclosed consequence without using personal documents. No automated test changes the developer's actual service state.

Release gates: pass existing Phase 1-3 regressions, new unit/integration/security tests, trusted IPC tests, production build, protected-runner packaging checks, and the disposable Windows matrix. Do not claim production readiness from mocks alone. Multi-process/backend-worker deployment remains gated on the separate Phase 3 coordination implementation.

## Proposed implementation files after approval

- backend/src/orchestrator/WindowsRepairCapability.js and WindowsRepairPolicy.js, new: schema, eligibility, fixed limits, typed plan and verdict policy.
- backend/src/orchestrator/CapabilityContracts.js, AgentExecutor.js, AgentOrchestrator.js and ToolEngineBridge.js: register one capability and read-only supporting actions, trusted admission, identity preservation and deterministic verification. AgentState remains the controller; extend audit metadata only if required by its protected mutation API.
- backend/src/orchestrator/ManualRecovery.js and CheckpointRecovery.js: capability-specific reconciliation rules and fresh evidence requirements without replay or terminal resurrection.
- backend/src/routes/repair.js, backend/src/ai/Orchestrator.js, backend/src/agents/BaseAgent.js and backend/src/orchestrator/LegacyExecutionAdapter.js: route the selected typed repair through the authoritative controller and block model shell fallback. Preserve utilities without keeping an execution bypass.
- frontend/tools/services/WindowsRepairService.js and frontend/tools/repair/PrintSpoolerRunner.ps1, new: broker handler and fixed protected runner; inspect, single start, and verify only.
- frontend/tools/ToolEngineRouter.js, ExecutionLedger.js and ConfirmationGate.js: dispatch policy, logical operation reservation, diagnosis-bound consent, renewal constraints and durable result handling.
- frontend/electron/ipc/tool.ipc.js, toolBridgeServer.js and packaging configuration: trusted approval/admission transport and protected runner packaging. Existing authentication and requestId cancellation remain intact.
- frontend/src/stores/useAppStore.js, services/api.js, services/chatExecution.js and components/ConfirmationModal.jsx: typed Auto Repair events, owned repair-session handoff and explicit approval/recovery status. Keep ordinary chat behavior as a mode.
- backend/src/knowledge/repair-guides/windows.md: describe the one typed path and its exclusions; other command catalogs do not authorize execution.
- backend/src/ai/RepairLogger.js and backend/src/schemas/repairSessions.schema.json: compatible typed-result projection and schema alignment; keep authoritative audit separate and preserve existing records.
- Focused tests beside the controller/policy, HTTP routes, frontend tools and trusted IPC; isolated Windows fixtures and a packaging check. Exact test filenames are finalized with implementation.

This is the proposed change surface, not a list of files already edited. Generic PowerShell/CMD implementations and the broad repair guides are not to be expanded as part of this capability. The larger generic-shell findings remain tracked risks; execution isolation is a prerequisite even if their full remediation is scheduled separately.

## Approval boundary and remaining risks

Approval would authorize implementation of one Spooler-start capability plus the necessary diagnosis, consent, dispatch isolation, recovery, audit and tests described here. It would not authorize execution on this machine, additional repairs, queue deletion, service restarts, privilege escalation, automatic compensation, dataset retraining, or multi-worker deployment.

Remaining inherent limits are queued-job side effects, outside changes between observations and start, Windows-managed dependency behavior, imperfect attribution after a crash, local installation trust, and service-running evidence that cannot establish physical printing success. Version 1 therefore uses a conservative supported profile and rejects uncertain preconditions. Broadening that profile is a separate reviewed change.

The implementation should proceed incrementally: first the contract and negative policy tests, then diagnosis and durable approval, then the single execution boundary and verifier, then failure/recovery tests and the isolated Windows validation. Do not add another repair until this capability passes those gates.

## Primary Windows references

Microsoft Service Security and Access Rights explains per-service access checks and SERVICE_START. https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights

Microsoft StartServiceW documents startup return behavior, native failures and blocking behavior. https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-startservicew

Microsoft QueryServiceStatusEx documents status access and the latest-reported-state limitation. https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-queryservicestatusex

Microsoft ServiceController.Start documents the parameterless .NET service-start operation. https://learn.microsoft.com/en-us/dotnet/api/system.serviceprocess.servicecontroller.start

Microsoft Starting a Service illustrates separate start and status polling. The design uses its own narrower rights and fixed deadlines rather than copying the example's all-access handles. https://learn.microsoft.com/en-us/windows/win32/services/starting-a-service
