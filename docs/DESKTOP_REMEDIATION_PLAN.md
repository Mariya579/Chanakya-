# Chanakya desktop audit and staged implementation

Audit date: 8 October 2026. The working tree already contains extensive staged,
unstaged, deleted, and untracked work. Existing changes and user data are preserved;
this task does not commit, push, reset, or install/download dependencies.

## Observed root causes before changes

| Area                | Observed cause                                                                                                                             | Planned correction                                                                                                           | Verification                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Chat upload         | Paperclip and drop call global knowledge ingestion; no draft attachments, message IDs, or history metadata                                 | Separate attachment drafts and explicit knowledge import; authenticate and bind document IDs to exact messages/conversations | Real multipart requests, UI composer/history, isolation tests                  |
| Upload feedback     | Unsupported files silently discarded; response waits for extraction/embedding after transfer reaches 100%; no cancel                       | Validation, visible per-file errors, cancellation and bounded ingestion                                                      | TXT/MD/PDF/DOCX fixtures, MIME/type/size failures, cancel                      |
| Document scope      | Retrieval filters user but searches all that user's documents; metadata drops scope and chunk details                                      | Additive scope/message migrations, bounded attachment retrieval with filenames/pages                                         | Cross-user and cross-conversation denial; extraction and chunk bounds          |
| PDF runtime         | Real valid PDF fixture fails the existing parser on Node 24 when supplied a Buffer                                                         | Pass copied Uint8Array to the existing PDF parser                                                                            | Actual two-page PDF extraction on Node and packaged Electron runtime           |
| Folder import       | No workspace model or folder picker; nonrecursive list defaults and denied children omitted                                                | Persistent per-user workspace roots; recursive hierarchy, counts, supported filters and error feedback                       | Nested/empty/unsupported folders, restart, safe symlink handling               |
| Settings/navigation | Profile is read-only despite functional update API; knowledge/permissions primary screens; raw tool JSON and command output in chat        | Working profile/workspace settings; advanced management; brief status while retaining central approvals                      | Profile persistence, settings/navigation, permission regressions               |
| Models              | Hardcoded supported model list and single model selection; installed qwen:latest rejected                                                  | Discover /tags and /show capabilities, persist two routes, deny general-route OS tools, bounded lifecycle                    | Real local model discovery/inference and missing-model tests                   |
| Installed apps      | Existing inventory, resolver, approvals, UIA and installer code require boundary audit                                                     | Preserve inventory-based behavior; fix verified gaps with deterministic identity and approval checks                         | Resolver ambiguity/misspelling and installer policy tests; read-only inventory |
| Packaged storage    | APP_DATA_PATH defaults to resources/backend, which is not reliably writable in Program Files                                               | Per-user data root for packaged app; conservative copy-only legacy migration; keep dev storage default                       | Writable runtime path and legacy preservation tests                            |
| Startup ports       | Electron kills any PID listening on 3001; dev PID check proves node.exe, not ownership                                                     | OS-assigned loopback port for owned backend, renderer/preload endpoint contract; never reclaim unrelated PIDs                | Hold 3001 with another server and verify it survives                           |
| Packaging           | Non-clean path preserves databases into installer; release removes old output/stash; installed deps and huge asset selection need checking | Offline release using existing runtime, fresh validated output, reject user storage/secrets                                  | NSIS build, byte-integrity validators, actual packaged binary smoke            |
| Lifecycle           | Translation child intentionally outlives app; health polling lacks request timeout/body disposal                                           | Clean up owned children only, bounded health checks and startup error recovery                                               | Close app, verify owned child exit and no unrelated kills                      |
| Configuration       | .env.example uses retired names and wrong API port; Express 4 SPA uses an Express 5 route pattern                                          | Document actual config keys; use correct SPA catchall; same-origin dev proxy                                                 | Development upload/UI and direct production SPA request                        |
| Tests               | npm test absent; Node execution of Electron runtime tests fails by runtime mismatch                                                        | Add runnable component suites and run Electron tests in Electron                                                             | Save actual pass/fail output; do not fabricate clean-machine/manual acceptance |

Actual read-only Ollama discovery found qwen:latest (completion, 32768 context),
qwen3.5:9b (completion/vision/tools/thinking, 262144 context), mistral:latest
(completion/tools), llama3:latest (completion), and nomic-embed-text:latest
(embedding). No assumption is made that another machine has these models.

## Implementation order and ownership

1. Backend attachment/extraction/scope pipeline and isolated integration tests.
2. Composer/history/navigation/profile and safe persistent workspace controls,
   using the backend contract; permission dialogs remain enforced.
3. Capability-discovered model routing/settings and audited installer boundaries.
4. Electron storage/endpoint/lifecycle and offline packaging hardening.
5. Combined development checks, production bundle, NSIS installer, actual packaged
   executable testing and evidence report. Live inference/OS tasks are only
   reported as passed when actually executed. Clean-machine acceptance requires
   an available separate test machine and is recorded as unverified otherwise.

Independent audited components can be implemented concurrently after this plan
is saved; dependent contracts and final integration remain sequential. Each
component runs its applicable checks before integration and packaging.

## Initial baseline

Node v24.18.0 and npm 11.16.0 are available. Root better-sqlite3 and LanceDB load
successfully. The existing hideConsoles Node test passes. The IPC and navigation
tests fail under plain Node because they require real Electron; rerun with the
documented Electron runner. Existing frontend/release-security contains an older
installer; its presence is not evidence that this task's changes were tested.
