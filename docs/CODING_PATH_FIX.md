# Coding project path fix — 25 October 2026

The reported task (`b64db80e-44af-4c33-beb2-03902d4310ca`) stopped on `code.search` because the local model supplied `path: "D:\\project"` for the selected project root. The guarded file API intentionally accepts relative paths. No source files had been created by that task.

The typed coding adapter now converts an absolute path inside the bound workspace into a relative path before dispatch. A root search becomes `path: ""`; an inside-root source file becomes, for example, `src/App.jsx`. Harmless leading `./` directory notation is handled consistently. Other roots, sibling-prefix paths, traversal, UNC/device paths, protected files and alternate data streams remain rejected. The native file guard, workspace grants, file-version checks and exact configuration-write approvals remain in force. File contents and command arguments are not rewritten.

Each new task now receives an actual root file listing before model planning, and the model instructions explain the relative path convention and direct file scaffolding. Directory creation is recorded separately from source file changes and verified with a directory listing, avoiding an attempted text read of a newly created folder. A directory alone cannot count as implementing a requested website.

## Verification

- 37 focused coding, routing, model, security and presentation tests passed, including a native Windows workflow with absolute root search, nested directory creation and source-file verification.
- Three directory-focused rechecks passed after tightening completion handling, including the newly added folder-only task case.
- The installed `qwen2.5-coder:7b` model completed a real root search using `path: ""`, with no invalid-path failure or malformed-output retries. The test used a disposable project, not the user's project. Evidence: `../.qa/coding-path-live-result.log`.
- The update was built successfully as a fresh runnable Windows app using Electron Builder's `--dir` option; it does not overwrite the running application or package account storage.
- The final Electron 37.10.3 executable passed a native workflow containing an absolute project-root search, creation of `src`, writing `src/packaged.js`, and separate directory/file verification. All four repaired backend modules match the current source by SHA-256. Evidence: `../.qa/coding-path-packaged-result.json`.

## Updated app

Run `frontend/release-path-fix-20261025105443/win-unpacked/Chanakya AI.exe` from its existing folder. Exit the previous instance with **Alt+F4**, open this executable, then choose **Code → Retry task**. The prior failed task remains in history; retry starts a fresh task against the same selected project. The title-bar X only returns to the bubble.

Project command execution is unchanged. Source file creation/editing and searches are supported; builds, dependency installation and tests still need the user's terminal when no verified command confinement provider is present.
