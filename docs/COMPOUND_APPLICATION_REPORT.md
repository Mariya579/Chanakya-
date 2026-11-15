# Compound application goal execution

## Outcome

The VS Code and VLC compound flows now run from the original request through target resolution, execution and goal verification. Launch success alone cannot complete these goals. The live Windows suite passed all seven checks, including a second target while each application was already running.

This report covers the latest compound-application request. The earlier broad Windows/UI report and its Calculator limitations remain separate; this change does not claim to resolve them.

## 1. Root causes

The existing orchestrator already loops over its plan. The defects were in planning, capability coverage and completion:

- The original planner instructed Qwen to generate one app-opening step, and its launch fast path consumed compound requests as application names.
- App tools lacked target resolution/opening and result dependencies. The earlier implementation added these, but needed stronger integration checks.
- Original-goal verification could accept target evidence without checking that it belonged to the requested app and resolved target.
- Chat had a separate completion path. Confirmation continuations could lose the original task, and the UI's tool-schema converter discarded nested target fields.
- Replanning could not reference an already-successful target resolver.

## 2–3. Files created and modified

Created in this follow-up:

- `backend/src/orchestrator/ApplicationGoal.js`: shared portable original-goal verification.
- `frontend/src/services/toolSchemas.js`: recursive tool-schema conversion.
- `frontend/tools/tests/appTargets.test.js`: target/action/fallback tests.
- `frontend/tools/tests/compoundWindows.integration.test.js`: full live orchestration tests.
- This report and `compound-windows-results.txt`, `compound-regression-results.txt`, `compound-build-results.txt`.

Modified in this follow-up:

- Backend orchestrator: `ComputerTaskPolicy.js`, `OrchestratorPlanner.js`, `Replanner.js`, `CapabilityContracts.js`, `Verifier.js`, `CompoundApplications.test.js`.
- Backend chat: `routes/chat.js`, `routes/computerChat.test.js`.
- Frontend: `src/services/chatExecution.js`, `src/stores/useAppStore.js`.
- Desktop tools: `services/AppService.js`, `apps/AppRegistryService.js`, `apps/DocumentTarget.js`, `apps/OpenTargetUI.ps1`.

Reused earlier implementation: AgentState dependency injection/checkpointing, AppCapabilities, FileAssociationService, ProcessService native target dispatch, Windows app discovery and UI Automation. No architecture rewrite, Git commit, push, reset, rebase, checkout, clean or Git configuration changes were performed.

## 4. Orchestrator

The existing plan/act/observe/decide/verify loop remains authoritative. AgentState already disallows verification of incomplete plans and DONE without a successful verdict. Tests now run a three-step plan and verify ordered dispatch, dependency injection and final goal checks. Failed steps and failed verification cannot yield DONE.

## 5. Planner

Recognized compound application requests generate a resolver step followed by `app.openWithTarget`. That action performs launch and observation together. Simple app-only commands retain `app.openApp`.

Qwen's general plan must retain every mandatory step. Unknown or invalid steps reject the entire plan. Model-generated `openWithTarget` plans must use a resolver reference rather than copying/inventing a path. Resolver queries must appear in the original user request. Replans may refer to completed resolver steps instead of redoing them.

## 6. Step dependencies

`params.targetFromStep` identifies an earlier `app.resolveTarget` step. AgentState accepts only a successful resolver result, clones the validated target into the pending request, and saves the concrete request before execution. Future/missing/wrong-tool references are rejected. Checkpoints preserve resolved parameters and confirmation resumes the exact pending action.

Chat now emits the same reference and resolves it from its owned execution state. An empty continuation message recovers the original task from the current user turn; the frontend also sends the saved original goal after confirmation.

## 7. openWithTarget

The existing AppService is the app action layer. It resolves installed apps, validates targets, checks capabilities, chooses a strategy, dispatches through ProcessService/UI Automation and returns structured evidence. It also exposes openApp, focusApp, closeApp, isAppOpen and getCapabilities.

Native target dispatch uses the discovered executable and a separate target argument with `shell:false`. Existing app processes do not cause an early return when a target is present. Responses retain `requestedApp`, canonical target, actual app identity, process ID, strategy and verification.

## 8. Capabilities and strategy selection

Registry entries now include capability metadata computed from small Code/VLC/browser/Notepad argument profiles. These profiles describe supported actions, not installation locations. App discovery remains dynamic.

Registered file associations provide a generic native fallback: only an already-discovered executable with a single target placeholder is accepted. The association's raw command string is never executed. Unknown native capabilities attempt accessibility-based File → Open. An unverified fallback response cannot be promoted to success.

## 9. VS Code flow

Resolve the user path or configured project alias → resolve installed Code → pass the canonical file/folder/workspace argument → observe a matching Code window → verify the original app and target → DONE. The live test opened one project through an alias and then another folder in an already-running Code instance.

## 10. VLC flow

Resolve the media path or configured alias → resolve installed VLC → pass the media argument → observe the media name in a VLC window → verify the original goal → DONE. Both `Open VLC and play …` and `Play … using VLC` are covered. Live tests used two 30-second silent WAV files, avoiding personal media and audible test output.

## 11. UI Automation fallback

Unknown native capabilities try discovered File/Open controls and a standard Windows file dialog. Dialog discovery now includes same-process modal windows outside the main window's subtree and waits for the dialog to appear. Sensitive windows are rejected. Successful fallback requires target-window verification.

No fixed coordinates are used. Unsupported or ambiguous controls produce a failure. The live suite validates native Code/VLC paths; generic dialog fallback dispatch and its verification gate are covered by unit tests, not a live ERP application.

## 12. Original-goal verification

The shared ApplicationGoal contract requires:

- Every mandatory step succeeded.
- Resolver query and returned provenance match the user's target query.
- Opening parameters use that resolved target and the requested app.
- Returned evidence names the same requested app and canonical target.
- A valid process/app identity and timestamped window-title verification are present.

Both backend orchestration and frontend chat apply this contract. A wrong target, launch-only result, incomplete sequence or process-only observation cannot complete the goal. Final responses use the verified target-opening result rather than the first app-launch result.

## 13. Security

Targets must normalize to supported types, have valid absolute existing paths or safe HTTP(S) URLs, and pass realpath/type validation. Traversal, alternate streams, scripts/installers/executables as document targets, credential-bearing URLs and malformed nested target data are rejected. Model plans reference backend resolver outputs; they do not supply executable paths or shell strings.

Opening normal targets remains SAFE_WRITE/ALLOW. Existing dangerous/critical system rules and confirmation ownership remain unchanged. Errors use structured statuses such as TARGET_NOT_FOUND, TARGET_TYPE_UNSUPPORTED, APP_LAUNCH_FAILED, PERMISSION_DENIED, UI_FALLBACK_FAILED and VERIFICATION_FAILED. No unverified side-effect replay was added.

## 14–15. Tests and results

| Validation                                                | Result                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Orchestrator, desktop tools and computer-chat regressions | 405 tests: 400 passed, 0 failed, 5 opt-in integration skips |
| Live Windows compound suite                               | 7 passed, 0 failed, 0 skipped                               |
| Focused new/extended tests after final validation changes | 20 passed                                                   |
| Frontend production build                                 | Passed; existing bundle-size warning                        |

Coverage includes simple launch, Code file/folder/workspace dispatch, VLC target replacement, already-running apps, missing project/movie, unsupported types, unknown-app fallback, resolver aliases, unsafe associations, nested schemas, failed second steps, wrong-target evidence, failed goal verification, three-step ordering, dependency references, replanning and empty chat continuations.

To reproduce the live suite in PowerShell:

```powershell
$env:CHANAKYA_COMPOUND_INTEGRATION='1'
node --test frontend/tools/tests/compoundWindows.integration.test.js
```

## 16. Remaining limitations

- “My project folder”, “this movie” and “this file” require an explicit path or configured alias. The live tests supplied aliases to their temporary fixtures. Production aliases belong in `app-targets.json` beside the app registry, or constructor configuration. No default project or personal movie was guessed.
- Exact-name search is bounded to configured roots (otherwise Documents/Desktop/Downloads), depth and entry limits. It returns ambiguity rather than choosing among matches.
- Window-title evidence has medium confidence: same-basename targets can be indistinguishable. VLC verification proves media loading, not uninterrupted playback. URL titles and workspace titles may not expose the full requested target; those cases remain unverified rather than being declared complete.
- The generic Open-dialog fallback supports standard English Windows controls. Arbitrary ERP search/customer workflows and custom dialogs require additional accessibility profiles; they are not claimed as implemented.
- Packaged-app target activation and unrestricted generic keyboard/mouse actions are not provided by this change.
- Earlier Calculator reuse instability and OS privilege denials for MMC tools remain outside this compound-task follow-up. Their earlier report is retained.
- The Electron installer was not rebuilt. Production frontend build, source regressions and the live Windows execution path were checked.
