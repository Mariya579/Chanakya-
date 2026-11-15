# Coding conversation UI and task execution repair — 25 October 2026

The failed task in the supplied screenshot (`d5176295-6126-4bc2-9f66-c218ef4765e5`) completed `workspace.inspect`, advanced past the last planned step, and stopped before checkpoint creation. `preparePlan` rejected the exhausted cursor as an incomplete step. The state guard now permits another plan after all previous steps have completed, while retaining the failure/replan guard for incomplete work.

The application now has a first-class **Code** sidebar entry and a **Chat / Code** header switch. Coding uses a conversation with follow-up messages and a separate file/source/diff panel. Narrow windows have Chat and Code views; approvals, cancellation, checkpoints and executed results remain available. The composer stays visible while the conversation scrolls. Recorded diffs remain available across follow-up tasks. Server-owned previous task context is checked against account and workspace ownership.

Failed tasks retain a structured error code and a recovery hint, including a Retry action for existing generic failures. Unexpected internal errors are logged by the backend. Validation intent no longer interprets “build a website” as an explicit build command, or “do not run commands” as a request to execute commands. File changes are checked against current contents, and summaries explicitly state when project tests/builds have not run.

Windows workspace containment checks now canonicalize roots consistently when the OS expands an 8.3 directory alias. Vite scans only the application HTML entry and ignores generated release/backend-runtime directories when watching development files.

## Verification

- Final full application suite: **625 passed, 1 failed, 2 skipped**. The remaining failure is the existing Windows installed-app discovery test under an inherited Restricted PowerShell policy (`frontend/tools/tests/desktopHelpers.test.mjs`), reporting `discovery_script_failed`. It is outside the coding execution path. Full output: `../.qa/coding-full-suite-final.log`.
- Coding regression coverage includes multiple sequential actions after inspection, checkpoint creation, an exact configuration-write approval, actionable failures/retry, owned follow-up context and a real native Windows file creation/hash verification.
- A live **qwen2.5-coder:7b** task created `hello.js`, recovered from an initial native helper timeout under packaging load, and completed with the actual file contents verified. It used no malformed-output repairs. The result explicitly reports no executed project tests/builds. Output: `../.qa/coding-live-result.log`.
- Browser checks cover legacy-task retry, approval, follow-up context, duplicate-turn prevention, source/diff views, stop, a 530-pixel window, and switching between Chat and Code. Screenshots use an isolated API fixture rather than the user's data: `../.qa/coding-chat-desktop.png`, `../.qa/coding-chat-narrow.png`, `../.qa/coding-code-narrow.png`.
- The final browser checks also assert that selecting code never scrolls the outer application frame. Auto-scroll is confined to the conversation; the fixed outer frame clips overflow.
- The delivered **Electron 37.10.3** executable ran the coding service against a disposable folder, created a real file, verified its current contents, and exited successfully. No existing account or user data was used. Output: `../.qa/coding-packaged-result.log`.

## Desktop artifact

Run `frontend/release-desktop-20261025102528/win-unpacked/Chanakya AI.exe` from its existing folder. The frontend index and the repaired coding service, state controller and workspace path service match the current source. Package checks verified 130 security files and confirmed that user storage is absent.

The runnable desktop package is the delivered artifact. The optional NSIS installer compression stage was stopped; no completed setup installer is delivered. Keep the executable alongside its resources. Exit the old instance with **Alt+F4** before opening this version, then choose **Code → Retry task**. The title-bar X returns to the bubble and does not exit the application.

## Runtime limit

The existing confinement requirement for arbitrary project commands is unchanged. The agent can create and edit guarded local source files. Dependency installation, project builds and project tests still need a terminal when no verified execution provider is installed; approvals do not bypass that requirement. The UI and completion summaries show this limitation rather than claiming those checks passed.
