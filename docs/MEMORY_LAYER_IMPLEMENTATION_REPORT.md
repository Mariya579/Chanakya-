# Chanakya AI Memory Layer Implementation Report

Repository owner review | 22 September 2026

Chanakya AI now has four scoped memory types sharing one manager, repository boundary, policy and retriever. Memory remains local in SQLite. AgentState remains the execution authority, and memory cannot grant repair approval, dispatch a tool or replace fresh diagnosis. Existing history, legacy memories, document RAG and repair checkpoints are preserved. No cloud dependency, automatic commit or push was added.

Validation passed 517 backend tests, 75 ToolEngine tests and 8 Electron checks: 600 passes, zero failures. The existing live Windows repair integration test remains skipped. The frontend build passed with bundle-size warnings. The new memory tests use isolated databases and a local Ollama protocol fixture; they do not establish the answer quality of a live Qwen model.

## A Existing architecture discovered

The audit inspected the backend and frontend source inventory, live database table names through a read-only connection, memory/history routes and services, authentication, model clients, document retrieval, Electron transport, AgentState/controller/checkpoint paths and repair integration before code changes.

The live SQLite database contained users, sessions, password_resets, folders, chats, messages, memories, documents, chunks and usage_log, plus SQLite's sequence table. backend/src/db/connection.js opens better-sqlite3 with WAL and foreign keys and applies backend/src/db/schema.sql. backend/src/services/db.js exports the connection. The standalone legacy ingest path still has chunks and usage_log tables; the running document pipeline uses per-user LanceDB stores.

The original memory feature used backend/src/services/memoryService.js and backend/src/routes/memory.js. One table stored id, userId, content, type and createdAt. Types were session, pinned and project. Existing routes were authenticated GET/POST/DELETE /api/memory and DELETE /api/memory/:memoryId. They had ownership checks, but no retrieval pipeline, expiry, semantic key conflicts, secret policy or task/system lifecycle separation.

frontend/src/services/api.js and useAppStore.js supplied memory CRUD calls. frontend/src/memory/MemoryPanel.jsx offered review/add/delete controls and described automatic memory retrieval that was not implemented. Its general category did not match the backend's allowed categories.

Chat uses /api/chat, persists chats/messages through historyService.js and sends client history to local Ollama. Document RAG uses searchChunks and per-user LanceDB. Authentication uses opaque random bearer sessions with only token hashes persisted, rather than JWTs. User identity comes from requireAuth, not a client-supplied userId.

AgentState, ExecutionController, AgentOrchestrator and AgentExecutor own execution, while checkpoint files, Electron's execution ledger and confirmation store provide recovery. The typed Spooler capability already requires current diagnosis and approval. Repair history projections are separate from authoritative execution evidence. Translator calls its local IndicTrans service; Qwen post-processing is separate and unchanged. Electron retains the authenticated loopback ToolEngine bridge and trusted IPC boundary.

The main architectural conflict was that the old generic memory labels could not represent the four requested lifecycles. The implementation therefore leaves those records intact as legacy data instead of silently reinterpreting them as long-term facts.

## B Final memory architecture

MemoryManager coordinates sanitized writes and retrieval. MemoryRepository supplies the shared SQLite connection, ownership checks, transactional long-term writes and metadata-only audit events. Four lifecycle services share that foundation, while retaining distinct schemas and expiration rules. MemoryPolicy and MemoryCandidateExtractor handle explicit writes and narrow deterministic extraction. MemoryRetriever selects and bounds context without vector infrastructure.

```text
User
 |
 v
Authenticated Chat or Agent request
 |
 +--> MemoryManager --> CandidateExtractor --> Policy
 |                                           |
 |                                           v
 |                                    Validated SQLite writes
 v
MemoryRetriever
 |
 +----------+-----------+-----------+-----------+
 |          |           |           |
Short Term  Task        System      Long Term
 |          |           |           |
 +----------+-----------+-----------+-----------+
 |
 v
Bounded MemoryContext as untrusted data
 |
 +---- Separate document RAG context
 +---- Current user input and fresh tool evidence
 |
 v
Local Qwen or Ollama
 |
 v
Response or proposed agent step
 |
 v
Existing AgentState and capability security checks

AgentState checkpoint --> filtered task-memory projection
Task memory never flows back as execution authorization
```

Request flow: authenticate, validate the conversation scope, obtain relevant memory, assemble a bounded data block, then call the existing local model. Read flow: owner-scoped repository reads, freshness/relevance filtering, precedence, duplicate removal and byte budgeting. Write flow: current-user candidate or filtered runtime observation, deterministic validation/policy, owner checks, deduplication, transactional persistence and safe audit metadata.

## C Files added

All paths below are relative to E:/chatbot. The working tree already contained earlier control-plane and repair changes; this report attributes only the memory work.

- backend/src/memory/migrations.js: additive, transaction-protected memory schema and migration marker.
- backend/src/memory/validation.js: shared input, identifier, secret, serialization and byte-count helpers.
- backend/src/memory/MemoryRepository.js: ownership, shared database access, audit retention and long-term persistence.
- backend/src/memory/MemoryPolicy.js: SAVE, DO_NOT_SAVE, ASK_USER, UPDATE_EXISTING and DELETE decisions.
- backend/src/memory/MemoryCandidateExtractor.js: deterministic candidates from the current user message only.
- backend/src/memory/MemoryManager.js: shared lifecycle services, conversation/tool projection, policy-mediated user writes and retrieval.
- backend/src/memory/MemoryRetriever.js: relevance, freshness, precedence, deduplication, budgets and structured context formatting.
- backend/src/memory/ShortTermMemoryService.js: conversation-scoped add/get/update/clear/compact operations.
- backend/src/memory/TaskMemoryService.js: filtered checkpoint context, bounded task events and completion/cancellation projections.
- backend/src/memory/SystemMemoryService.js: local probes, cache classification, timestamps, refresh, invalidation and snapshots.
- backend/src/memory/LongTermMemoryService.js: explicit save, get, search, update and delete operations.
- backend/src/memory/runtime.js: application instance, request context and best-effort checkpoint projection.
- backend/src/memory/routes.js: typed authenticated memory endpoints mounted through the existing memory router.
- backend/src/memory/Memory.test.js and MemoryApi.test.js: 29 focused unit and integration tests.
- docs/MEMORY_LAYER_IMPLEMENTATION_REPORT.md and Chanakya_Memory_Layer_Implementation_Report.docx: implementation report.

## D Files modified

- backend/src/db/connection.js: runs the additive migration after the existing schema.
- backend/src/services/memoryService.js: preserves legacy APIs, rejects new credential-bearing entries and withholds recognizable sensitive legacy content from display without deleting it.
- backend/src/routes/memory.js: reuses requireAuth and mounts typed routes before legacy routes.
- backend/src/services/historyService.js: publishes filtered conversation context after existing history writes.
- backend/src/routes/chat.js: policy-mediated explicit memory extraction, reported tool context, bounded retrieval, separate data-message injection and current-message precedence.
- backend/src/ai/llmClient.js: adds scoped memory data to local structured completions used by agent planning; current request/runtime evidence follows it.
- backend/src/orchestrator/CheckpointStore.js: publishes filtered task context only after the authoritative checkpoint has been saved.
- backend/src/routes/agent.js, repair.js and orchestrate.js: establish owned conversation/request context for new agent workflows.
- backend/src/routes/models.js: caches model names obtained from the existing local Ollama discovery call.
- frontend/src/services/api.js: long-term CRUD calls and streamed memory decision notifications.
- frontend/src/stores/useAppStore.js: repair conversation linkage and user-visible save/consent notices.
- frontend/src/memory/MemoryPanel.jsx: focused long-term add/edit/delete/search controls and a separate view of legacy entries.

No package dependency, ToolEngine execution policy, Windows repair command, translator engine or document vector-store implementation was changed for the memory layer.

## E SQLite schema and migrations

Migration version 1 is applied transactionally and safely repeats. It creates six memory tables plus memory_migrations. Existing tables and records are not replaced, copied or dropped.

- short_term_memories: id, user_id, conversation_id, key, value, source, created_at, updated_at, expires_at. A composite foreign key ties conversation and owner to chats; a unique scope/key prevents duplicate updates.
- task_memories: task_id, user_id, optional conversation_id, revision, filtered JSON value and timestamps. Deleting a conversation detaches task history; deleting the account cascades it.
- task_memory_events: task identity, owner, revision, compact event data and timestamp. A unique task/revision pair prevents replay duplicates; only the latest 100 events per task are retained.
- system_memories: machine/key primary key, value, STATIC/SEMI_STATIC/DYNAMIC classification, source, verification timestamp and expiry. This is shared authenticated machine context, not a user preference store.
- long_term_memories: id, owner, category, canonical key, value, source, confidence and timestamps. A unique user/key pair implements deterministic replacement.
- memory_audit: event name, memory type, owner, request/conversation/task references and timestamp. It contains no memory values or raw tool payloads; the latest 1,000 events per user are retained.

Indexes cover conversation/owner lookup, expiry, task scope/revision, long-term category/time and audit ownership. Queries bind values as SQLite parameters. The existing memories table remains readable through its original APIs. It is deliberately excluded from automatic retrieval until a user explicitly saves a fact into the new long-term store.

## F Short term memory flow

History remains history. After a user or assistant message is saved, a sanitized bounded context entry is offered to ShortTermMemoryService. Reported chat tool observations are separately labelled as cached context; results containing recognized approval or credential fields are rejected before memory storage.

Scope is userId plus conversationId. Defaults are 24 entries, 16,000 UTF-8 bytes of stored values per conversation and a 24-hour lifetime. Add/get operations compact the window and lazily remove expired entries for that user. Deleting the conversation cascades its short-term rows. No compaction path promotes content into long-term memory.

Services expose getShortTermMemory, addShortTermMemory, updateShortTermMemory, clearShortTermMemory and compactShortTermMemory. Limits are constructor configuration, not client-controlled route parameters. Secret-bearing messages remain outside the new memory store; this change does not retroactively redact the independent chat-history database.

## G Task memory flow

Checkpoint persistence publishes a projection containing task identity/type, goal, phase, retry count, selected Spooler capability where applicable, completed/failed/pending step descriptions, bounded observations, diagnosis summary, scoped result and checkpoint reference/revision. Raw params, raw output, confirmation IDs and approval records are not copied.

Newer revisions replace older projections; duplicate or stale revisions do not overwrite them. Task history is owned by the authenticated user. APIs can explain the previous result or identify the checkpoint to inspect. Explicit resume still uses the original checkpoint and existing recovery/approval checks, never the task-memory projection.

createTaskMemory, updateTaskMemory, appendTaskObservation, getTaskMemory, completeTaskMemory and cancelTaskMemory manage context only. They contain no executor. Projection failure is logged with a fixed marker and does not turn a successfully saved execution checkpoint into an execution failure. This separation can leave task memory behind the checkpoint; the stored revision makes that limitation visible.

## H System memory flow

Read-only local Node probes populate OS platform/version/build, hostname, CPU model, total RAM, free RAM, runtime version and a capability-version description. The existing model-discovery route supplies locally installed Ollama model names. No PowerShell, privileged probe or cloud inventory service was introduced.

STATIC entries default to 30 days, SEMI_STATIC to one hour, and DYNAMIC to five seconds. Reads expose source, lastVerifiedAt, expiresAt, classification and freshness. A backward wall-clock change also makes an entry ineligible for fresh retrieval. Snapshots explicitly identify themselves as cached context and state that actions require fresh diagnosis.

getSystemMemory, setSystemMemory, refreshSystemMemory, invalidateSystemMemory and getSystemSnapshot are provided. Public endpoints are read/refresh only; clients cannot set arbitrary machine facts. Expired entries are excluded from model retrieval. Explicit refresh remains available when only some cache entries have expired. GPU and installed-application inventories were not added; additional safe probes can use the same service later.

## I Long term memory flow

Long-term facts use an explicit key, value and category. The management panel supports create, edit, search and delete. Accepted writes are recorded as explicit_user with confidence 1. A changed explicit value updates the same key and emits a conflict-resolution event rather than creating a contradictory duplicate. A maximum of 500 facts per user bounds retrieval and storage through this interface.

Current-user phrases such as Remember that I prefer Tamil and From now on reply in English update preferred_language. Other explicit Remember statements can become keyed facts. I always use VS Code produces ASK_USER and does not persist automatically. The chat interface tells the user when a candidate was saved, rejected or requires an explicit save request.

This is a narrow deterministic extractor, not unrestricted semantic extraction. Complex or unsupported phrasing can be saved through the explicit management UI/API. Legacy entries remain separately reviewable and deletable; there is no silent migration of generic instructions into active preferences.

## J Memory retrieval flow

MemoryRetriever obtains current-conversation short-term rows, recent tasks associated with that conversation or an explicitly requested owned task, fresh machine facts, and relevant user facts. It uses deterministic lexical relevance and recency; preferred_language is generally relevant. No extra embedding model or vector database is needed for the bounded initial corpus.

Precedence is enforced when assembling context: current user and fresh tool evidence remain outside and after cached memory; conflicting supplied fresh-evidence keys suppress cached entries. Within memory, task context is considered before short-term, system and long-term data. Duplicate keys and normalized duplicate values are removed. Chat turns containing current tool results suppress cached system entries.

Default serialized budgets are short term 1,536 bytes, task 1,536, system 512, long term 1,024 and total 4,096 bytes including the rendered wrapper. Entries that do not fit are omitted. Configuration cannot raise the total above 4,096 bytes. These are conservative UTF-8 byte limits, not exact Qwen tokenizer measurements. Existing document/history context remains separately managed.

## K Memory write policy

SAVE accepts a valid explicit user fact. UPDATE_EXISTING replaces a matching owned key. ASK_USER retains no candidate in the database. DO_NOT_SAVE rejects model/document-origin candidates, recognized secrets, unsafe authorization narratives and unconfirmed temporary claims. DELETE is an explicit owned API/UI operation.

All candidates pass deterministic validation before persistence. The model has no arbitrary memory-write tool or database endpoint. Uploaded document content and assistant output never enter the long-term candidate extractor. Conversation and task writes are bounded projections rather than full transcript/checkpoint copies.

Recognized password, bearer, JWT, API key, session-token, approval/confirmation, private-key and opaque credential patterns are rejected or withheld. Audit events store only identifiers and event types. This is conservative pattern-based protection, not proof that an arbitrary unlabelled string can never be a secret; that residual limitation is listed below.

## L Qwen integration

Chat receives a memory_context data message containing separate short_term, task_memory, system_memory and long_term arrays. JSON serialization escapes angle brackets, ampersands and line-separator characters so stored text cannot close the wrapper or create another system tag. A system instruction explicitly treats the contents as untrusted cached data.

Structured agent completions receive the same bounded data only when an authenticated request scope is present. The current task and runtime evidence follow it. The fixed Spooler workflow continues to use deterministic diagnosis/approval/verification and does not need a model-generated repair plan.

Document RAG remains a separate source section. Current user input and tool-call identity are preserved. Tests inspect the actual request sent to a loopback Ollama protocol fixture and verify that the new explicit user message follows memory even when previous history ends with a tool response.

## M Windows Repair memory security boundaries

Memory cannot dispatch a capability, elevate privileges, consume a confirmation, alter a checkpoint or reopen a terminal session. It does not replace host/configuration checks, current diagnosis, token lineage, operation reservation, idempotency, cancellation, reconciliation or deterministic verification.

Task projections omit approval tokens and execution params. Authorization-like long-term statements such as yesterday's approval are rejected. Cached facts can help explain prior work; they cannot become current service-state evidence. The existing repair tests were rerun, including invalid approvals, uncertainty, recovery and one-start enforcement. No Windows repair mutation was performed during this work.

## N Authentication and ownership security

Typed routes are mounted after the existing requireAuth middleware. They derive ownership from the verified session. Long-term writes reject unknown fields, including attempted userId/source/confidence assignment. Read/update/delete queries include owner checks, and foreign IDs return a generic not-found response.

Task/conversation references are validated before use. Database foreign keys independently prevent a short-term row from binding another user's conversation. Account deletion cascades user-owned memory. Machine cache reads require authentication but intentionally describe the same local machine to its authenticated users.

Routes added are GET/POST /api/memory/long-term, PATCH/DELETE /api/memory/long-term/:id, GET /api/memory/tasks/:id, GET /api/memory/short-term/:conversationId, POST /api/memory/short-term/clear, GET /api/memory/system and POST /api/memory/system/refresh. Legacy routes remain. Typed responses use Cache-Control no-store.

## O Test results

- Backend regression: 517 passed, zero failed, zero skipped. Command: npm test in backend. This includes the existing dataset, auth, translator, RAG, orchestration and repair suites.
- New memory coverage: 29 tests, included in the backend total. Coverage spans idempotent migration, legacy preservation, conversation isolation, expiry/compaction, deletion cascade, task projection/revision, owner isolation, system freshness, fresh-evidence precedence, explicit save, update/dedup/delete, credential rejection, authorization rejection, injection escaping, relevance, budget limits, tool observation filtering and restart persistence.
- HTTP integration verifies authentication, ownership on every mutation, foreign reads, spoofed metadata rejection, system write rejection, checkpoint projection and actual local Ollama request assembly.
- ToolEngine regression: 75 passed, zero failed; one existing isolated Windows test skipped.
- Real Electron checks: five IPC trust tests and three navigation tests passed.
- Frontend production build: passed with existing large-chunk warnings. No installer was rebuilt or installed.
- git diff --check: passed without whitespace errors.

Aggregate: 600 passed checks and one skipped live Windows integration test. Focused reruns are not counted again. Evidence logs are .memory-backend.log, .memory-tools.log, .memory-focused.log, .memory-ipc.log, .memory-navigation.log and .memory-build.log.

## P Remaining risks

1. Extraction and retrieval are deterministic and narrow. They do not yet provide multilingual intent parsing, semantic paraphrase matching or learned relevance. Explicit keyed management is the reliable path for complex preferences.
2. Secret detection uses field selection and recognizable patterns. Unlabelled novel secrets can evade pattern detection. Existing chat history, documents and legacy on-disk data are not retroactively redacted or deleted.
3. Escaping and instruction hierarchy reduce prompt-injection ambiguity but do not make model behavior provably immune. Execution remains protected by independent capability/approval controls. Memory must never be added to those authorization checks.
4. Task memory is a best-effort projection. A crash between checkpoint save and projection can leave it stale until another checkpoint update. Inspect the authoritative checkpoint/ledger for recovery decisions.
5. Short-term expiry is lazy, triggered by subsequent memory access for that user. Idle expired rows are not returned but can remain on disk until that access or conversation deletion. No background job was added.
6. System memory has a deliberately small read-only probe set. Partial expiry can require explicit refresh. Hostname-derived machine identity changes after a hostname change. Cached values are not repair preconditions.
7. Tests used a local Ollama protocol fixture; real Qwen response quality and end-user interaction with the revised panel need a local usability pass. The frontend was build-validated, not exercised through a new automated browser UI suite.
8. Installed-package validation and the pre-existing disposable Windows repair matrix remain outstanding. No installer, multi-worker coordination or new repair capability is included. The existing writable-storage deployment assumptions remain unchanged.

## Q Recommended next phase

Run a local Qwen memory-quality evaluation using representative follow-up questions, language changes, conflicting facts and hostile stored text. Validate the Memory panel in the packaged desktop application. Measure relevance before considering local vector retrieval; reuse the existing local architecture if lexical retrieval proves insufficient.

Then consider rebuild-on-inspection for stale task projections and a privacy review of retention and secret-detection policy. Preserve the execution boundary: additional memory sophistication must never create a shortcut around current diagnosis, capability validation, explicit approval or verification.
