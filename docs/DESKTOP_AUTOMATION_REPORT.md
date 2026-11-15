# Desktop automation implementation report

## Root causes

1. The existing orchestrator already advances through all plan steps and refuses DONE with incomplete steps. It was not executing only `steps[0]`.
2. The planner explicitly instructed the model to use one `app.openApp` step for application requests. Its fast path also treated the remainder of a compound command as an app query.
3. There was no app target-opening capability, target resolver, or step-output injection contract.
4. A single successful app launch passed deterministic verification even if the original request included opening a project or media. Normal chat had a separate completion path with the same gap.
5. Discovery merged names/aliases by shared executable identity. Windows host executables could absorb shortcut names, while the generic executable policy correctly rejected tools such as MMC. There was no separate trusted system-interface registry to distinguish opening a console from changing system state.
6. Calculator already supported dynamic binary arithmetic. Its service nevertheless activated the app for every calculation. Hosted UWP windows require discovery below Application Frame windows, not just top-level process identity.

## Discovery, resolution and system interfaces

Existing Start Menu, App Paths, uninstall metadata, MSIX and selected PATH discovery remain in place. Registry persistence, startup refresh, periodic refresh and one refresh on a miss are preserved. Applications still come from discovery; installing VLC does not require a code change.

Shared Windows host executables are excluded from installed-app alias merging. The separate code-owned WindowsSystemCapabilityRegistry defines Control Panel, Settings, File Explorer, Task Manager, Device Manager, Services, Event Viewer, Disk Management, Registry Editor and Windows Security. Executables, URI arguments and MMC console paths are fixed by code. Discovered or model-provided arguments cannot extend those definitions.

Exact system names/aliases take precedence, followed by exact installed canonical names, existing aliases, token matches and fuzzy matching. Ambiguity remains explicit. Missing installed apps are refreshed once and reported without attempting installation. Confidence is returned for successful resolution.

## Plans, dependencies and completion

Compound commands such as `Open VS Code and open D:\Projects\Test` and `Play D:\Movies\movie.mp4 using VLC` produce:

1. `app.resolveTarget`, with the user-provided query.
2. `app.openWithTarget`, with the app name and `targetFromStep` referring to the resolver step ID.

AgentState resolves the reference only to an earlier, successful `app.resolveTarget` step. It injects a cloned target before recording the execution attempt, so checkpointing and confirmation preserve the concrete input. Missing, forward and wrong-tool dependencies cannot dispatch. Existing step/retry budgets and confirmation state remain authoritative.

Invalid mandatory model steps now invalidate the whole plan; they are not silently discarded. Both orchestrator verification and normal-chat completion reject a compound goal fulfilled only by app launch. All mandatory steps must still succeed. Target verification compares returned target evidence to the actual dispatched target.

Chat emits the resolver and target-opening calls sequentially from tool evidence. It does not ask Qwen to provide an answer instead of executing those calls.

## Targets and application capabilities

Targets normalize to FILE, FOLDER, URL, MEDIA, DOCUMENT or WORKSPACE. UNKNOWN is resolved to an actual file/folder type. Paths must be absolute, exist, pass realpath/type checks, and contain no traversal, alternate stream, wildcard or malformed path syntax. Executables, scripts, installers, shortcuts and registry/console files are rejected as document targets. URLs are limited to HTTP(S), without embedded credentials.

`resolveTarget` accepts explicit paths, configured aliases, or exact filenames under a bounded search of Documents/Desktop/Downloads. Searches are limited to 8 roots, 2 subdirectory levels and 2,000 entries; multiple matches return AMBIGUOUS_TARGET. Unresolved phrases such as “my project” return a clear failure rather than an invented path.

For installations using an app registry directory, administrators may create `app-targets.json` beside `app-registry.json`:

```json
{
  "aliases": {
    "my project folder": { "type": "FOLDER", "path": "E:\\chatbot" }
  },
  "roots": ["E:\\Projects", "D:\\Movies"]
}
```

Only configure paths that actually exist. Constructor-provided `targetAliases` are also supported.

Small capability profiles describe native argument semantics for Code, VLC, browsers and Notepad. They do not define installation locations. Strict Windows file-association parsing provides a generic path: only an already-discovered executable with a single `%1`/`%L` placeholder is accepted. Association command strings are never executed. `app: "default"` selects that verified association.

`openWithTarget` validates the target, resolves the app, checks capabilities, and launches an executable with a separate target argument and `shell:false`. An already-running app still receives its new target. Results include strategy, target, process and verification confidence.

Unknown native capabilities attempt a standard accessibility File → Open dialog fallback. It discovers menu/dialog controls before use, checks sensitive fields, sets the filename and verifies the resulting app title. Unsupported dialogs fail explicitly.

## UI Automation and Calculator

Generic accessibility actions now include findWindow, waitForWindow, isWindowOpen, focusWindow, listControls, findControl, waitForControl, readText and tab navigation. App focus/status/confirmed-close actions use this service. Selection favors AutomationId, then name/control type, then class. Ambiguous windows/controls fail rather than selecting arbitrarily. Password, credential, PIN and OTP controls, including labelled controls and sensitive ancestors, are excluded.

Calculator keeps its bounded binary expression parser and validates reusable button IDs before invocation. It discovers an existing Calculator through its authenticated AppUserModelId and display control, remembers the observed process, and looks again before activation. It reads and numerically checks the actual display after input. A desktop mutex prevents separate automation workers from entering UI sequences simultaneously.

## Permissions, confirmation and retries

| Action                                                                          | Classification                 | Decision                   |
| ------------------------------------------------------------------------------- | ------------------------------ | -------------------------- |
| Discovery, target resolution, capabilities, UI inspection                       | READ                           | ALLOW                      |
| App/system-interface opening, target opening, focus, tab navigation, Calculator | SAFE_WRITE                     | ALLOW                      |
| App close and existing permitted system mutations                               | DANGEROUS                      | Existing confirmation gate |
| Existing critical security, arbitrary shell and protected registry operations   | CRITICAL or blocked capability | BLOCK                      |

The existing ConfirmationGate and owned execution state are preserved. Approval resumes the pending step with saved observations and remaining plan; rejection does not execute it. Regression tests cover confirmation, cancellation, recovery and protected operations.

Explicit retryability survives observation normalization. Non-retryable target/permission failures and unverified side effects stop rather than blindly repeating a launch. Retryable failures use the existing replan budget. Accessibility waits are bounded observation polling, not a second task-level retry budget.

## Verification strength

Ordinary launch verifies a process or window. Windows interfaces use accessibility window observation with a matching Windows process identity. Native target opening requires both a successful invocation and a target-name match in a window belonging to the resolved executable. A process alone cannot verify a target-opening task.

Window-title matching is reported with **medium confidence**. It does not prove a full canonical filesystem path when two folders/files share a basename. VLC evidence proves that the media is loaded in its window, not uninterrupted playback or audible sound. URLs whose hostname is absent from the window title remain unverified.

## Files created

- `frontend/tools/apps/WindowsSystemCapabilityRegistry.js`
- `frontend/tools/apps/DocumentTarget.js`
- `frontend/tools/apps/AppCapabilities.js`
- `frontend/tools/apps/FileAssociationService.js`
- `frontend/tools/apps/GenericUI.ps1`
- `frontend/tools/apps/OpenTargetUI.ps1`
- `backend/src/orchestrator/CompoundApplications.test.js`
- `frontend/tools/tests/desktopGoals.test.js`
- `frontend/tools/tests/desktopGoalsWindows.integration.test.js`
- This report and test/build output logs.

## Files modified

- `frontend/tools/apps/AppDiscoveryService.js`, `AppResolverService.js`, `AppTargetPolicy.js`, `InteractWithApp.ps1`
- `frontend/tools/services/AppService.js`, `ProcessService.js`, `UIAutomationService.js`
- `frontend/tools/security/ToolRegistry.js`, `ToolRequestValidator.js`
- `frontend/tools/repair/contract.js`, `frontend/tools/ToolEngineRouter.js`
- `frontend/src/services/chatExecution.js`
- `backend/src/orchestrator/ComputerTaskPolicy.js`, `TaskRouter.js`, `OrchestratorPlanner.js`, `CapabilityContracts.js`, `AgentState.js`, `Verifier.js`, `ObservationHandler.js`, `DecisionEngine.js`, `WindowsRepairContract.js`
- `backend/src/routes/chat.js`

Existing unrelated working-tree changes were retained. No commit, push, reset, rebase, checkout, clean or Git configuration change was performed.

## Remaining limitations

- This is not unrestricted automation of every application. Arbitrary mouse coordinates, generic button mutations, free-form keyboard injection and generalized system-setting modifications remain unavailable. Existing Calculator/Notepad adapters and bounded navigation are retained; additional actions require effect-aware profiles.
- Generic accessibility inspection currently needs an executable identity. Packaged Calculator/Notepad use their existing authenticated adapters. Generic packaged-app target activation is not implemented.
- The generic Open dialog fallback supports English standard Windows dialogs. Custom ERP/web-view dialogs and folder pickers need an additional profile; fallback fails safely when their controls differ.
- Named concepts such as “this movie” or “my project” need an explicit path or configured alias. No file-picker/context memory was invented.
- Device Manager and Services were allowed by the tool policy but Windows returned EACCES in this session. The app now reports PERMISSION_DENIED. UAC/elevation is not bypassed.
- System titles/control names may need localization profiles on non-English Windows.
- Calculator supports two nonnegative operands with +, -, *, / and decimals. Chained expressions, square roots and percentages remain outside the adapter's supported grammar.
- Electron installer packaging was not rebuilt. The frontend production build and source tests are the validation scope.

## Latest validation after retry

- Automated regression run: **393 tests, 389 passed, 0 failed, 4 opt-in integration tests skipped**. Includes agent state, planning, dependencies, permission routing, confirmation/recovery, discovery, UI contracts and desktop chat tests. See `automation-test-results.txt`.
- Frontend production build: **passed**, with a bundle-size warning. See `desktop-build-results.txt`.
- All three added/modified accessibility PowerShell helpers passed syntax parsing.
- Latest live Windows run: **8 passed, 3 failed, 2 skipped** (the failed parent suite is included in the failure count). Control Panel, Settings, Task Manager, Calculator 1+1 / 25+78 / 456*23, both VLC media targets and the final VS Code folder assertion succeeded.
- Calculator 100/4 intermittently failed to rediscover its hosted window; the decimal calculation returned a result but used a different Calculator process, failing the strict reuse assertion. Earlier runs passed all five expressions and reuse, so the full Calculator acceptance criterion is **not reliably satisfied**. This is unresolved, not a passing integration result.
- Device Manager and Services are skipped in the live suite only after verifying policy ALLOW and receiving Windows PERMISSION_DENIED. No elevation or UAC bypass was attempted.
- The VLC fixture was lengthened to 30 seconds of silence because a one-second clip could finish before window verification. Both target replacements passed on the latest run.
- See `desktop-windows-test-results.txt` for the live evidence and failures. Generic dialog fallback, arbitrary ERP interaction, and additional system modifications have not been live-validated.

The requested upgrade is therefore partially implemented and tested; it is not a claim that every acceptance criterion in both specifications is complete.
