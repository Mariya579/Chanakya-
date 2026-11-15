# Installed application discovery and launching

Implemented September 23, 2026. Existing unrelated workspace changes were preserved. No Git commit, push, reset, checkout, rebase, or configuration changes were performed.

## Architecture before and after

Before: the Electron AppService accepted four executable names; the backend planner mapped application names to executable strings. Readiness used a fixed list of known executable names.

After: TaskRouter → name-only planner proposal → authenticated ToolEngine bridge → ToolRegistry / permission guard → AppService → local registry and deterministic resolver → target validation → existing ProcessService → process observation → deterministic backend verifier. App launching remains in Electron, where the existing process services and Windows user session live. A second backend process launcher was not introduced.

The model-facing process.startProcess route is now denied; operator-only legacy controls retain their existing restrictions. Model requests use `{ "tool": "app", "action": "openApp", "params": { "query": "Visual Studio Code" } }`.

## Files created

- `frontend/tools/apps/AppDiscoveryService.js`
- `frontend/tools/apps/AppRegistryService.js`
- `frontend/tools/apps/AppResolverService.js`
- `frontend/tools/apps/AppTargetPolicy.js`
- `frontend/tools/apps/DiscoverApps.ps1`
- `frontend/tools/apps/ActivateApp.ps1`
- `frontend/tools/tests/appRegistry.test.js`
- `frontend/tools/tests/appWindows.integration.test.js`
- `backend/src/orchestrator/AppLaunching.test.js`
- This report.

## Existing files modified

- `frontend/tools/services/AppService.js`: dynamic tools, results, missing/stale/ambiguous handling.
- `frontend/tools/services/ProcessService.js`: internal validated app launch and observation; absolute Windows PowerShell path.
- `frontend/tools/ToolEngineRouter.js`: app registry startup and shared ProcessService.
- `frontend/tools/security/ToolRegistry.js`: explicit read and safe-write classifications and app timeout.
- `frontend/tools/security/ToolPermissionPolicy.js`: preserve operator legacy restrictions while denying model process launches.
- `frontend/tools/repair/contract.js` and `backend/src/orchestrator/WindowsRepairContract.js`: synchronized model capability policy.
- `frontend/electron/ipc/tool.ipc.js`: per-user storage wiring.
- `backend/src/orchestrator/TaskRouter.js`: general application names.
- `backend/src/orchestrator/OrchestratorPlanner.js`: name-only launch proposals; removed application-to-executable map.
- `backend/src/orchestrator/CapabilityContracts.js`: app parameter and evidence validation.
- `backend/src/orchestrator/DecisionEngine.js`: stop on app outcomes instead of replanning another launch.
- `backend/src/orchestrator/Verifier.js`: evidence-based application completion messages.
- `backend/src/orchestrator/ToolEngineBridge.js`: bounded 60-second app request budget.
- `backend/src/routes/chat.js`: registry-based app instructions.
- `backend/src/orchestrator/Phase2.test.js`, `frontend/tools/tests/toolPermissions.test.js`, and `frontend/tools/tests/windowsRepair.test.js`: update existing assertions to the new contract.

Several of these files already existed as untracked work before this task; this list describes changes made during this task, not their Git tracking state.

## Discovery sources

| Source                     | Implementation                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User and system Start Menu | Recursively inspect `.lnk`; resolve through WScript.Shell without executing shortcuts. Accept argument-free executable targets.                                                                                                                            |
| Uninstall registry         | Inspect HKLM native/WOW6432Node and HKCU; use DisplayName, DisplayVersion, Publisher, InstallLocation, and DisplayIcon to enrich independently discovered targets. Never launch an uninstall command or infer that an arbitrary icon is an app executable. |
| App Paths                  | HKLM native/WOW6432Node and HKCU; read registered target and file version metadata.                                                                                                                                                                        |
| Packaged apps              | Windows Get-StartApps supplies installed launch identities, display names, and package family identifiers, including Calculator, Photos, Store, and Settings.                                                                                              |
| Selected PATH entries      | Inspect code.exe, python.exe and git.exe only. Script wrappers are excluded, and interpreter/CLI targets are blocked from normal app launching.                                                                                                            |

Executable identities are deduplicated by case-insensitive full path; packaged apps by AUMID. Matching packaged executable aliases under WindowsApps are merged when package and display identity agree. Names from other sources enrich aliases.

## Local schema and storage

Storage is `<Electron userData>/app-registry/app-registry.json`, outside the application installation directory. JSON was chosen because discovery executes in Electron; there is no need for another SQLite owner or a backend copy of the installed inventory.

Envelope: `schemaVersion`, `scannedAt`, `errors`, `apps`.

Each app includes `id` (stable SHA-256-derived target identifier), `name`, `normalizedName`, `aliases`, `publisher`, `version`, `source`, `launchType`, `executablePath`, `launchArgs`, `appUserModelId`, `packageFamilyName`, `installLocation`, `iconPath`, `available`, `firstSeen`, `lastSeen`, and `updatedAt`. Blocked entries additionally carry `blockedReason`. Launch arguments are currently always empty. Some source-specific metadata is unavailable and remains empty.

User aliases are separate in `app-aliases.json`. An internal `setUserAlias(alias, id)` API supports future UI/conversation integration; there is no model-facing alias mutation endpoint yet.

## Resolution

Normalize Unicode, case, punctuation, and executable suffixes. Generate aliases from names, executable basenames, package names, vendor-shortened names, and a small supplementary common-app alias map. VLC has no curated mapping.

Exact unique matches score 1 and resolve immediately. Whole-token matches score 0.94. Edit-distance similarity is discounted by 0.94; queries shorter than four characters do not fuzzy-match. Candidates below 0.65 are discarded. Automatic fuzzy/token selection requires at least 0.90 confidence and a margin of 0.08 over the next candidate. Otherwise return up to ten candidates. Multiple exact matches remain ambiguous.

Queries are always data. Command punctuation and path syntax cannot become executable commands. Tools return only relevant public metadata, never executable paths or the complete registry.

## Security and permissions

Search, resolve, installation checks, and app info are READ. Normal app opening and local cache refresh are SAFE_WRITE. Existing authentication, ToolRegistry schemas, ToolPermissionPolicy, audit, and execution ledger remain in the call chain. Caller-supplied executable paths and extra launch parameters are rejected.

Launch validation checks discovery source, target existence, `.exe` extension, absolute local path, alternate streams, traversal, temporary directories, resolved junction/symlink location, and regular-file type. Scripts, command interpreters, installer helpers, and selected sensitive management targets are blocked. Shortcut arguments are excluded rather than interpreted. Network paths are not launchable. All application spawns use `shell:false`.

Cached JSON is never accepted as launch provenance: the first use in each desktop session re-establishes targets from Windows discovery. Final target checks occur in ProcessService immediately before launching. This defends against edits to the registry cache; it is not an antivirus or a defense against an attacker who already controls application code or the installed executable itself.

There is no installer/download action, winget install, license acceptance, elevation, or credential collection. Restricted targets are conservatively blocked rather than sent through an unrestricted helper approval route.

## Refresh and cache behavior

Startup loads cached data immediately and refreshes missing/stale data in the background. `APP_REGISTRY_REFRESH_HOURS` defaults to 12. A periodic timer and `app.refreshAppRegistry` provide refreshes. Concurrent scans share one promise; writes use a temporary file and atomic rename. A missing match triggers a fresh scan and a second lookup. A missing cached executable is marked unavailable and refreshed before returning a result.

A fresh on-disk cache still requires one live provenance scan on first use in a new desktop session. Ordinary subsequent successful lookups do not scan. Incomplete sources produce APP_DISCOVERY_INCOMPLETE instead of a false missing-app claim. Complete scan failures produce APP_DISCOVERY_FAILED. Scans have a 25-second deadline; app bridge/tool calls have a 60-second budget.

## Installed-app flow and verification

Resolve an installed app, validate its target, and invoke ProcessService. For executables, spawn the verified absolute path with no shell or arguments, then observe a running process with the same absolute executable path. This also handles a launcher handing off to an existing instance. For packaged apps, IApplicationActivationManager activates the discovered AUMID and returns the application PID, which is checked with Get-Process. See Microsoft's [ActivateApplication documentation](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication).

Only verified evidence yields APP_OPENED and “<name> opened successfully.” A PID from spawn alone does not qualify. Observation failures return APP_LAUNCH_UNVERIFIED. Verification is process-based; it does not prove the application window is foreground or fully interactive. A launched application intentionally outlives the tool call and is not killed when a later tool deadline expires.

## Missing and ambiguous flows

- No match → one fresh rescan → no match → APP_NOT_INSTALLED with INSTALL_REQUIRED and a display name. Photoshop suggests Adobe Photoshop. No installation runs.
- A matching blocked target returns APP_UNSAFE_TARGET, not “not installed.”
- Several credible matches, such as Studio → AMBIGUOUS_APP with candidate IDs/names and a question asking which one the user means. No launch runs.
- App failure/ambiguity outcomes stop replanning, preventing accidental duplicate launch attempts or a fallback to generated shell commands.

## Tests and results

- Backend full suite: **519 passed, 0 failed**.
- Tool Engine full suite: **118 passed, 0 failed, 2 opt-in integration tests skipped** (120 total).
- Explicit Windows integration: **1 passed**. Discovered local apps, passed Calculator and VLC through the authenticated model-origin ToolEngine permission route, launched both, and verified their processes. No VLC-specific source entry was added.
- Focused planner/registry suite also covered exact aliases, Microsoft Word, PowerPoint, token matching, ambiguity, weak fuzzy matches, malicious queries, blocked paths, separate aliases, cache reload/provenance, concurrent refresh, simulated post-start install, stale executable removal, partial discovery, and missing Photoshop suggestions.
- Frontend production build passed. Vite reported its existing large-bundle warning.

Commands: `npm test` in backend; `node --test frontend/tools/tests/*.test.js`; `CHANAKYA_APP_INTEGRATION=1 node --test frontend/tools/tests/appWindows.integration.test.js` (set the environment variable using the host shell); `npm run build` in frontend.

One earlier backend assertion expected the retired launch action and was updated. An intermediate overloaded Windows run exceeded a discovery deadline, and a temporary ten-second generic process-query timeout was too short; the final checks passed after correcting the generic query budget and running verification with a single bounded observer process.

## Known limitations

- Requires the running Windows desktop/Electron ToolEngine; a standalone backend cannot launch desktop applications.
- Argument-bearing shortcuts, script launchers, custom URI-only apps, and applications discoverable only from an uninstall icon are intentionally unsupported. No recursive Program Files guessing is performed.
- Python/Git and other interpreters or sensitive helpers are not treated as ordinary safe GUI launches. No generalized signed-helper approval workflow was introduced.
- There is no certificate reputation, malware scanning, enterprise policy integration, or protection against replacement of a target by a same-user attacker between validation and Windows process creation.
- Packaged publisher/version metadata is not fetched from every package manifest; AUMID/family and display name are retained. Nonstandard executable-to-package aliases can remain ambiguous.
- A completely new installer was not run. Newly installed app behavior was exercised with controlled discovery snapshots; the already-installed VLC supplied the real dynamic discovery/launch acceptance check.
- No chat UI for alias editing or registry browsing, filesystem change watcher, optional winget search, or automatic installation was added.
- Source and production web build were updated; a new Windows installer/EXE was not built by this task. Restart the development desktop app to load these changes, or include them in the next packaged desktop build.
