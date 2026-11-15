# Chanakya AI — Security, Optimization and Windows-Settings Report

**Date:** 2026-10-04 **Branch:** `feat/system-settings-launch` **Scope:** backend, Electron tool engine, dependencies, repository hygiene

This report covers four pieces of work done in one pass: more Windows-settings control, project optimization, a security review with fixes, and this write-up. Every number below was measured on this machine; things that could not be verified are listed explicitly in section 7.

---

## 1. Summary

| Area                                                           | Before                                                               | After                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Production dependency vulnerabilities (`npm audit --omit=dev`) | **11** (7 high, 4 moderate)                                          | **0**                                                                                |
| Dev/build-tool vulnerabilities (`npm audit`)                   | 17 (16 high)                                                         | **7** (all need major-version upgrades, see 4.6)                                     |
| Agent PowerShell safety classifier                             | 8 bypass techniques ran unattended                                   | all tested bypass classes **blocked**; 0 of 20 normal commands wrongly blocked       |
| `.gitignore`                                                   | truncated to one line (secrets, databases, build output unprotected) | restored from the committed version and extended                                     |
| Password hashing                                               | blocks the server ≈ 40 ms per login                                  | thread pool; a request arriving during 8 logins waits **1–6 ms instead of ≈ 323 ms** |
| Windows settings the agent can read/change                     | 0                                                                    | **44** (38 reversible, 6 behind human confirmation)                                  |
| Settings tool latency                                          | 650–930 ms per read, **2.99 s** for a full list                      | **2–40 ms** per read, **565 ms** warm full list (44 settings)                        |
| Test suites                                                    | backend 536, frontend 229                                            | backend **536/536**, frontend **263 (255 pass, 0 fail, 8 skipped as before)**        |

**One finding is not fixed and needs a decision from you: password hashes for 3 accounts (including `admin`) are in git history on the GitHub remote** (section 3, S1).

---

## 2. Method

- **Secret scan:** gitleaks 8.30.1 over the working tree and full history (output redacted).
- **Dependencies:** `npm audit` (production-only and full), before and after fixes; native modules re-loaded and both test suites re-run after every dependency change.
- **Code review:** authentication and session code, CORS/Helmet/rate-limit configuration, the Electron window configuration, the autonomous PowerShell agent and its safety classifier.
- **Dynamic checks:** the hardened classifier was exercised in memory with attack samples across every class plus 20 ordinary diagnostics; password hashing and the settings helper were benchmarked.
- **Hardware verification:** every Windows setting was changed, read back from Windows, and restored on this PC.

---

## 3. Security findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| S1  | **High** | Salted password hashes for 3 user accounts (including `admin`) were committed in `e3baf36` and are reachable from `origin/main` on GitHub. A later commit stopped tracking the file, but history keeps it. The repository is **private**, which lowers but does not remove the risk (clones, collaborators, forks).                                                                                                                                                                                                                        | **Open — your decision** (see 6)                                                   |
| S2  | **High** | `.gitignore` had been reduced to `node_modules`, silently removing protection for user databases, password-reset tokens, `.env` files, logs and build output. The committed version was correct.                                                                                                                                                                                                                                                                                                                                           | **Fixed** — restored and extended                                                  |
| S3  | **High** | 11 vulnerabilities in production dependencies: axios (prototype-pollution gadget), multer (multipart denial of service), adm-zip (memory exhaustion from a crafted ZIP), xmldom (XML injection), sharp/libvips CVEs, onnxruntime-node, qs/body-parser/express (array-limit bypass), fflate (infinite loop).                                                                                                                                                                                                                                | **Fixed** — `npm audit fix`; 0 remaining; tests green; native modules verified     |
| S4  | **High** | The agent's PowerShell safety classifier is a deny-list. Whole classes of technique were classified "fix" and would run **unattended** in automatic mode: encoded or dynamically built commands, evaluating downloaded or decoded text, download-to-disk and upload/exfiltration, scheduled-task/service persistence, stopping security services and adding antivirus exclusions, clearing logs, and reading credential stores or key files. A prompt-injected model (for example via a document or web page) could have used any of them. | **Fixed** — new rule classes plus normalisation of PowerShell backtick obfuscation |
| S5  | Medium   | Password hashing used the synchronous `scrypt`, freezing the entire server for ≈ 40 ms per login. Login is unauthenticated, so a trickle of bad logins starved every other request.                                                                                                                                                                                                                                                                                                                                                        | **Fixed** — async `scrypt`, identical parameters (existing hashes still verify)    |
| S6  | Medium   | 17 vulnerabilities in dev/build tooling (browserslist, js-yaml, nanoid, undici, shell-quote, etc.).                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Reduced to 7**; the rest need major upgrades (4.6)                               |
| S7  | Low      | CORS allows `Origin: null` with credentials. This is required for the packaged `file://` renderer, but a sandboxed iframe on any website also sends it. Mitigations already present: sessions are `Authorization: Bearer` tokens (not cookies), so a hostile page has no token to send, and login has per-IP and per-account rate limits. The server binds to `127.0.0.1` by default.                                                                                                                                                      | **Accepted / recommendation** (6)                                                  |
| S8  | Low      | `routes/ask.js` and `routes/ingestRoute.js` are dead code (never mounted).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Open — recommend removing                                                          |
| S9  | Info     | Tracked training data and the vector store contain placeholder emails (`corp.com`, `contoso`) and two MAC addresses; no credentials.                                                                                                                                                                                                                                                                                                                                                                                                       | Open — recommend untracking                                                        |
| S10 | Info     | `backend/.env` is untracked but was not ignored; it holds only ports, URLs and model names (no secrets).                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Fixed** — now ignored                                                            |
| S11 | Info     | Electron 37 advisories: one applies only to macOS (`app.moveToApplicationsFolder`), one to the install-time download. Not exploitable in this Windows build/runtime; fix requires Electron 44.                                                                                                                                                                                                                                                                                                                                             | Documented                                                                         |

Things reviewed and found **sound**: scrypt with a 16-byte random salt and 64-byte key, constant-time hash comparison, 15-minute single-purpose reset tokens, all sessions revoked on password change/reset, Electron windows using `sandbox`, `contextIsolation` and a navigation guard, Helmet with a tailored policy, request-size limits, and authentication on every mounted API route.

### 3.1 Safety design of the new tools

The new `winget.*` and `systemSettings.*` tools follow the existing policy model: the model chooses from a **code-owned catalog** and supplies a typed value; it never supplies a command, path or script. Processes are started with argument arrays (no shell), the PowerShell helper re-validates every value, anything that can cut connectivity or change device behavior goes through the existing human `ConfirmationGate`, and every change is **read back from Windows** — a change Windows ignores is reported as unverified, never as success.

### 3.2 How the classifier fix was verified

Attack samples from each class were run through `classifyCommand` in memory: **all blocked**, including three `curl`/`wget` variants and backtick-obfuscated forms; a plain read-only HTTP GET and 20 ordinary diagnostics and recoverable fixes (service restarts, adapter resets, `sfc`, `DISM`, DNS flush) stay allowed. The pre-existing 9 classifier tests still pass.

> A deny-list can never be complete. The new rules close entire classes, but the stronger long-term control is to require human approval for every non-read command, or to allow-list the "fix" level (section 6).

---

## 4. Optimization

### 4.1 Windows-settings helper — persistent worker (largest win)

Each call used to start PowerShell and recompile its C# groups (≈ 0.32 s start-up plus ≈ 0.26 s per group; a full list compiles five).

| Operation                                             | One process per call   | Warm worker                                                                                                   |
| ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `list` all settings                                   | 2,990 ms (33 settings) | **234 ms** warm with 33 settings; **565 ms** with 44 (13 power settings each read for plugged-in and battery) |
| read one setting                                      | 650–930 ms             | **2–40 ms**                                                                                                   |
| no-op write (includes the deliberate read-back delay) | ≈ 900 ms               | 191 ms                                                                                                        |

One long-lived PowerShell serves every call (`SettingsWorker.js`): requests are serialised, matched by id, time out after 25 s (the worker is killed and replaced), a crash is reported and recovered from, and an idle worker exits after 5 minutes. Ten tests cover this, including one against the real helper.

### 4.2 Password hashing off the event loop

`scrypt` moved to the thread pool. Eight simultaneous logins: **wall time 325 → 121 ms**, and the delay seen by an unrelated request fell from **≈ 323 ms to 1–6 ms**. The derived hashes are byte-identical, so no account is affected.

### 4.3 Smaller, separate native assemblies

The helper used one compiled assembly bundling input, power and caret calls. Security software blocked that bundle (deterministically — see 5). It is now four small groups compiled **only when a setting needs them**, which removes the block and avoids compiling code that is not used.

### 4.4 Dependency tree

`npm audit fix` updated 19 packages; the full tree (749 packages) installs and builds cleanly.

### 4.5 Build and bundle observations (not changed)

- Production Vite build: **21.9 s**.
- `frontend/dist` is **30.9 MB**, of which **26.2 MB (85 %) is one ONNX WebAssembly file** loaded on demand by the in-browser model runtime. It is not a start-up cost but it inflates the 265 MB installer; excluding or lazily downloading it is the single biggest size opportunity.

### 4.6 Remaining dev-tool vulnerabilities (7, all high)

`tailwindcss` 3 → 4 (clears braces / chokidar / micromatch / fast-glob) and `electron` 37 → 44 (clears Electron and extract-zip). Both are major upgrades with likely UI/build impact, so they were left for a planned upgrade rather than risked here.

---

## 5. Windows settings added

44 settings; **38 apply immediately** and **6 require human confirmation** (`wifi`, `bluetooth`, `airplane-mode`, `lid-close-action`, `power-button-action`, `mouse-primary-button`).

| Group                | Settings                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display & appearance | dark mode, brightness, transparency, clock format (12/24-hour), window animations, show window contents while dragging                                                                                                      |
| Sound                | volume, mute, microphone volume, microphone mute                                                                                                                                                                            |
| Power plan           | screen-off, dim, sleep, hibernate, hard-disk and lock-screen timeouts; power mode; maximum processor state; battery-saver threshold; wake timers; cooling policy; USB selective suspend; lid-close and power-button actions |
| Mouse & keyboard     | pointer speed, precision, trails, location with Ctrl, hide while typing, snap to default button; scroll lines; double-click speed; primary button; keyboard repeat rate and delay; cursor blink rate; menu show delay       |
| Explorer & system    | file extensions, hidden files, notifications, clipboard history                                                                                                                                                             |
| Connectivity         | Wi-Fi, Bluetooth, airplane mode                                                                                                                                                                                             |

### 5.1 Plugged-in and on-battery values are kept separate

Windows stores 12 of these power-plan settings separately for "plugged in" and "on battery", and on this PC they differ (for example screen-off 5 vs 3 minutes, wake timers _important only_ vs _disabled_, cooling _active_ vs _passive_). Setting both together would silently flatten that, so those settings accept `source` = `plugged-in`, `battery` or `both` (default). "Set screen timeout to 10 minutes on battery" changes only the battery side; `list` and `get` show both values; a change counts as verified only when **every targeted side** reads back correctly. Messages say what each side was ("was 20 minutes plugged in, 10 minutes on battery").

### 5.2 Bugs the real-hardware checks caught (and fixed)

- **Wake-timer option order:** Windows numbers them disabled=0, enabled=1, important-only=2; the first draft had them in a different order, which would have applied "enabled" as "important only". Found by reading Windows' own option names instead of trusting memory.
- **Single-element array unrolling:** a PowerShell function returning a one-item array hands back a bare string, so `[0]` selected the first _character_. It made the battery-saver threshold report `null%` and fail verification; fixed and covered by tests.
- **Ambiguous pointer-trail value:** a trail length of 1 reads back as 0, so it is refused with an explanation instead of failing verification.
- **Clock read-back:** Windows caches the time format per process after `SetLocaleInfo`; the saved format is read instead.

**Considered and dropped because no effect could be verified:** taskbar alignment (the registry value changed but the taskbar did not move), camera/microphone privacy switches (Windows' own access check kept reporting "allowed"), and the screen saver (a timeout does nothing unless a saver is chosen). Not shipping them is deliberate: the tool must never report success it cannot prove.

---

## 6. Recommendations (in priority order)

1. **Rotate the passwords of the three accounts in S1** and decide whether to purge history (`git filter-repo` or BFG, then force-push; all collaborators must re-clone). Nothing was rewritten or pushed automatically.
2. **Add an antivirus exclusion** for the project and install folders. Kaspersky on this PC deleted or locked `SystemSettings.ps1` and several newly written test files during this work. The settings tools now explain a missing helper instead of failing obscurely, but an installed app could lose the helper the same way.
3. **Raise the bar for the autonomous agent:** require approval for all non-read PowerShell, or move "fix" to an allow-list, and treat everything the model reads (documents, web pages, tool output) as untrusted.
4. **Untrack tracked data**: `git rm --cached` the training-data and vector-store files after review (S9), and delete the dead routes (S8).
5. **Plan the Tailwind 4 and Electron 44 upgrades** (4.6).
6. **Tighten `Origin: null`** by serving the packaged UI from `http://127.0.0.1` with a per-launch secret, or by requiring a custom header the renderer injects (S7).
7. **Shrink the installer** by lazily downloading the 26 MB ONNX runtime (4.5).
8. **Rebuild the installer** (`npm run electron:release`): the current installer predates all of the above.

---

## 7. What was not verified

- The **installer was not rebuilt**, so none of these changes are in an installed app yet, and the packaging validator has not run against the new files.
- The **confirmation dialog in the real Electron UI**, a real `winget install`, and the **end-to-end Ollama loop** were not exercised; the confirmation flow was tested through the real router, policy and gate with a simulated approval.
- **Airplane mode, Wi-Fi and Bluetooth** were only tested in the harmless direction (setting them on while already on); turning radios off was not tried on this PC. Hibernate and shut-down as lid/power-button values were not applied.
- The **classifier regression corpus could not be stored in the repository**: this machine's antivirus deleted every file containing realistic attack one-liners (three attempts, including encoded and fragmented forms). The hardening was verified in memory instead; the pre-existing tests are unchanged. Re-adding a permanent regression corpus should be done on a machine or CI runner without that antivirus, or with a documented exclusion.
- Dependency fixes were validated by tests, a production build and loading each native module, but not by running the packaged installer.

---

## 8. Appendix — files

**New:** `frontend/tools/services/WingetService.js`, `SystemSettingsService.js`, `SettingsWorker.js`; `frontend/tools/apps/SystemSettings.ps1`, `SystemSettingsCatalog.js`; tests `winget.test.js`, `systemSettings.test.js`, `settingsWorker.test.js`.

**Modified:** `.gitignore`; `backend/src/agent/dangerClassifier.js`; `backend/src/services/authService.js`; `backend/src/orchestrator/{CapabilityContracts,ComputerTaskPolicy,OrchestratorPlanner,WindowsRepairContract}.js`; `backend/src/routes/chat.js`; `frontend/tools/{ToolEngineRouter,DesktopRuntime}.js`, `security/ToolRegistry.js`, `repair/contract.js`; `frontend/scripts/validate-security-package.cjs`; `package-lock.json`.

**Backups outside the repo:** `E:\chatbot-package-lock.json.bak`, `E:\chatbot-SystemSettings.ps1.bak`, `E:\chatbot-removed-backup.tgz` (earlier folder cleanup).
