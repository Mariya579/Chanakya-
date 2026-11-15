# General Windows application agent — implementation and verification

Date: 25 September 2026. Workspace: E:\chatbot.

## Outcome

Typo resolution, dedicated browser automation, bounded accessibility inspection, semantic matching, scoped app context, discovery metadata, and permission integration are implemented. This is **not full acceptance**: public browser search reached search pages but visible search results could not be verified in this environment. Vision is an optional fail-closed adapter with no local provider configured. General application support remains dependent on the accessibility controls each app exposes.

## Root causes

- The resolver lacked a tested confidence/margin policy for typos and common aliases.
- Native Windows interfaces need code-owned launch identities; shortcut discovery alone is insufficient.
- PATH helpers can share the desktop application's product name (VS Code's code-tunnel.exe caused duplicate candidates). GUI subsystem filtering now prevents that collision.
- Packaged apps can appear as both an executable and an application identity. Unique package identities now coalesce those entries.
- General desktop routing had moved ahead of the existing compound and dedicated browser/UI handlers. That intercepted searches, arithmetic, and target-opening requests. All execution and verification paths now use the same admission order.
- Opening an application was insufficient evidence for compound goals. Existing target evidence and the added browser/page evidence are retained through completion checks.
- UI observation required better UWP identity matching, bounded traversal, sensitive-control filtering, fresh inspection, and semantic summaries.
- No dedicated owned Chromium session previously handled browser goals.

## Files added for this upgrade

- frontend/tools/browser/BrowserPolicy.js
- frontend/tools/services/BrowserAutomationService.js
- frontend/tools/services/AppInspectorService.js
- frontend/tools/services/VisionFallbackService.js
- frontend/tools/apps/SemanticUIResolver.js
- backend/src/orchestrator/BrowserTask.js
- frontend/tools/tests/generalAgent.test.js
- frontend/tools/tests/appInspection.test.js
- frontend/tools/tests/browserWindows.integration.test.js

The workspace already contained other uncommitted application-agent work. This report does not claim ownership of every modified/untracked file.

## Files updated/integrated

Resolver/discovery: AppResolverService.js, WindowsSystemCapabilityRegistry.js, AppDiscoveryService.js, DiscoverApps.ps1, AppService.js, ProcessService.js.

Inspection/execution: GenericUI.ps1, UIAutomationService.js, ToolEngineRouter.js, security/ToolRegistry.js, security/SecurityAudit.js, repair/contract.js.

Orchestration: BrowserTask.js, ComputerTaskPolicy.js, CapabilityContracts.js, TaskRouter.js, OrchestratorPlanner.js, AgentOrchestrator.js, Verifier.js, WindowsRepairContract.js; frontend/src/services/chatExecution.js.

Packaging/tests: frontend/package.json, package-lock.json, appRegistry.test.js, compoundWindows.integration.test.js, and the tests listed above.

## Resolver and confidence policy

1. Normalize Unicode NFKC, case, punctuation, repeated spaces and executable suffixes.
2. Prefer code-owned exact system names/aliases, then unique exact canonical app names.
3. Match aliases from executable metadata, publisher/word abbreviations, curated common names, and user aliases.
4. Compare compact spacing and reordered tokens.
5. Apply Damerau-Levenshtein distance, including adjacent transpositions.
6. Evaluate confidence, runner-up margin, truncation, ambiguity and app risk.

Scores: canonical 1; alias .99; compact spacing .98; reordered tokens .97; partial token .88. Plausible fuzzy candidates use .96 minus .025 per edit, with a .10 truncation penalty. Maximum edit distance is one for short names and two at length ten or above; fuzzy auto-resolution requires at least four query characters, the same first character, score >= .90 and a .06 lead. Unique exact canonical matches take precedence; duplicate canonical names stay ambiguous. Weak candidates below .65 are discarded. A single-word alias matching other product-name tokens stays ambiguous.

These rules were checked against the requested typo corpus, unrelated strings, duplicate names, ambiguous Studio products, and injection-shaped input. They are conservative heuristics, not a universal probability estimate. Sensitive administrative apps never auto-resolve from fuzzy matches.

## System registry and discovery

Trusted fixed launch entries cover Control Panel, Settings, Bluetooth Settings, Explorer, Task Manager, Device Manager, Services, Event Viewer, Disk Management, Registry Editor, Windows Security, PowerShell and Command Prompt. Opening a shell uses only its fixed launch definition; command execution remains blocked.

Discovery reads Start Menu shortcuts, App Paths, uninstall metadata, packaged identities, running GUI processes, Shell AppsFolder, and GUI executables on PATH. RegisteredApplications file/protocol associations enrich already discovered executable identities. Registry command strings are never executed. Association discovery has a 200-entry / 2.5-second budget. A local scan after the performance fix completed in about eight seconds with no reported source errors. Cached discoveries are revalidated before use and refreshes coalesce.

## Inspection and semantic capabilities

AppInspectorService resolves the application, reads the current UI, filters sensitive/hidden/disabled controls, returns at most 200 controls and hashes the observation. Capability maps are reused only when app identity and control fingerprint are unchanged. GenericUI traverses a bounded breadth-first tree (depth eight, 300 controls), supports UWP identity matching, and verifies window ownership. When multiple windows match, it uses a unique matching foreground window or reports ambiguity.

SemanticUIResolver maps observed labels to intents such as open_file, open_folder, search, play, pause, volume and Calculator operations. A unique .90+ semantic match is required; close scores stay ambiguous. Inspection does not itself grant permission. Inspector navigation is restricted to tabs and expandable menus and reinspects afterward. The existing GenericDesktopService separately provides opaque snapshots, grounded actions and fresh evidence checks for unknown apps.

App context is scoped to the caller. Successful opens retain app/process identity; inspection adds window identity, last observation and capabilities. Bare arithmetic such as “add five and four” requires the actual Calculator foreground window before execution. It cannot silently launch Calculator based only on chat memory.

## Browser implementation

Playwright Core 1.63.0 controls a discovered Chrome/Edge/Brave executable using a separate persistent profile per caller/application. The Chromium sandbox stays enabled. The service reuses its managed session and supports tabs, navigation, search, visible link clicks, non-sensitive text entry, scrolling, titles, URLs, visible text/elements, waits, back/forward and the browser's downloads page. attachBrowser attaches only to an existing managed session; arbitrary personal profiles are not attached.

Element IDs are opaque and validated against a fresh DOM fingerprint before use. First-result selection is restricted to search providers and heading-associated links, not arbitrary positional selectors. Search uses Bing and requires both the requested query and a visible result heading before success. A challenge, blank results area, timeout, or provider error is not success.

Implementation reference: https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context and https://playwright.dev/docs/api/class-browsercontext#browser-context-route .

## Permissions and confirmation

| Operation                                                                               | Policy                 |
| --------------------------------------------------------------------------------------- | ---------------------- |
| Inspect apps, read safe page content                                                    | READ                   |
| Open apps, navigate, search, scroll, safe link/type actions                             | SAFE_WRITE             |
| Browser form submission, closing native apps, destructive file/service/registry actions | Approval required      |
| Arbitrary shell/model-generated commands, disabling security controls                   | Blocked                |
| Downloads/uploads/payments or unimplemented side effects                                | Not implicitly enabled |

Browser submission uses the existing durable confirmation gate and exact action parameters. Approval is caller-bound; stale elements fail after approval. Only the approved form's navigation endpoint/method is admitted during submission, and credential-bearing forms remain blocked. Cancellation/rejection uses the existing task checkpoint and approval handling. Downloads-page viewing does not authorize downloading files.

## Security and privacy

Launches use validated discovery or exact code-owned system entries, fixed arguments and non-shell process creation. Unsafe paths/scripts/interpreters and injected app names remain rejected by the launch policy. Existing permission checks still run immediately before execution.

Browser inspection never returns input values; password, OTP, PIN, card and credential labels/fields are filtered. Sensitive titles are omitted and public URL output removes fragments and non-search query parameters. Browser dialogs are dismissed; downloads, service workers, WebSockets and unapproved non-read HTTP requests are blocked. Approved form submission remains narrowly scoped. Website content is untrusted. Conservative controls intentionally restrict some dynamic websites.

Audit output projects task/request identity, tool/action, policy/risk/result, safe application ID, confidence and execution strategy. It does not serialize typed values, page contents, credentials or arbitrary result objects.

## Vision fallback

VisionFallbackService accepts only an injected local capture/analyzer, verified target-window bounds and redaction regions. It filters low-confidence/out-of-window detections, requires subsequent accessibility validation, and clears temporary image buffers. No local provider is configured and no coordinate executor is exposed. It currently returns VISION_UNAVAILABLE rather than guessing.

## Verification

- Full automated regression: 415 passed, zero failed, six optional live tests skipped (421 total).
- Real managed Chrome fixture: passed. Covered navigation, session reuse, sensitive-value exclusion, stale references, typing, tabs, back/forward, scroll and blocked POST requests.
- Real Windows compound suite: seven passed, zero failed, including “open vscoed and open my project” and “open vlcc and play this movie.” Targets were explicit temporary aliases and silent generated audio.
- Live Control Panel: typo launch passed; 52 safe controls observed.
- Live Bluetooth Settings: opened and verified a visible Bluetooth control; Settings inspection exposed 70 controls.
- Live Calculator: 5+4 displayed 9. Later inspection exposed 40 controls.
- Live VS Code inspection: 12–13 controls observed. Rich editor content is not fully exposed at this bounded depth.
- Live Notepad inspection: 35 controls observed. VLC inspection encountered multiple matching windows and returned AMBIGUOUS_WINDOW; media opening was separately verified.
- Public search: not accepted as complete. Google presented a challenge; Bing reached the OpenAI search URL/title but exposed no verified visible result heading. DuckDuckGo likewise did not expose results. No challenge was bypassed. The final implementation uses Bing and returns an explicit verification error in this case.
- Frontend production build passed; the existing large-chunk warning remains. A newly packaged installer was not built or installed.
- PowerShell files parsed without syntax errors.

Machine-readable/text results: general-agent-test-results.txt, browser-windows-results.txt, general-agent-compound-windows.txt, general-agent-live-results.txt, general-inspection-results.txt and general-agent-build-results.txt.

## Remaining limitations

1. The complete six-command acceptance set is not green because public search results remain unavailable in this environment.
2. “My project” / “this movie” require an explicit configured target or prior resolved file context. The agent never invents those paths.
3. Unknown apps are limited by their accessibility providers; multiple windows can still require clarification. No claim is made that every UI/control is supported.
4. Local vision is an adapter boundary, not an installed vision model or working coordinate fallback.
5. Browser automation reuses owned profiles only. Authentication, downloads, uploads, payments and arbitrary account changes are not generalized.
6. Discovery budgets may omit optional association metadata on machines with many registrations. Uninstall entries remain metadata-only.
7. Foreground arithmetic follow-up is verified conservatively and can refuse ambiguous hosted windows.
8. Authentication/chat/repair and security regression tests passed, but every RAG/voice/translator workflow and packaged installer was not exercised end to end.

No commit, push, reset, checkout, rebase, clean, or Git configuration change was performed.
