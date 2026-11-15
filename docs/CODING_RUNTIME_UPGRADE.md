# Coding agent runtime update — 25 October 2026

This update adds approved local project execution to the Code workspace in localhost and the packaged desktop app. It supersedes the edit-only command limitations in the earlier coding implementation, UI and path reports. The local Ollama model still determines code quality; adding tools does not turn a 7B model into Claude or GPT.

## Use

1. Select the project and enable project changes.
2. Open **Run & packages**, enable **Allow project commands**, and optionally **Allow package downloads**.
3. Ask for an app or retry a failed task. Review each exact command/install approval. The agent can run checks, read real errors, edit and retry.
4. Use **Run app** for a selected Python/JavaScript entry file. Use **Start localhost** for a project with a `dev` npm script; choose another port if occupied. Logs, actual exit status, **Open localhost preview** and **Stop** appear in the Run panel.
5. If Python is absent, **Install Python** requests an approved user-scope WinGet installation. Tkinter comes with the Windows Python distribution. It is not a pip package.

Exit an older desktop build with Alt+F4 before opening the new EXE; the window close icon can collapse the assistant to its bubble. Existing account/workspace storage is retained.

## Fixes

- Search accepts a specific file as well as a directory. Searching `src/calculator/calculator.py` no longer attempts a directory listing only.
- A new checkpoint starts from current contents. An observed external edit rotates the baseline after a fresh version read. Older checkpoints stay available and still reject unsafe restores. A stale expected file version still cannot overwrite external changes.
- npm manifest/lock changes are recorded in checkpoint history so dependency installation does not look like an unexplained external edit on the next source change.
- The agent gets application-owned Python/Tkinter, React/Vite and package instructions. Project files and command output cannot grant permissions. If a model finishes early, the service prepares known Python syntax/unittest or npm build checks through the same exact approval path. Passing checks bind to the recorded source revision; later edits require fresh checks. Empty unittest discovery cannot count as passing tests.
- Tool signatures retain every parameter without repeating JSON Schema boilerplate, keeping the complete catalog and Python guidance usable at a 4096-token context when resources permit. Complete schemas still validate every action.

## Execution boundary

Project commands use a separate explicit `approved_local` mode. They run with the current Windows account's access. They are not filesystem/network sandboxed. The legacy isolated `CommandExecutionService` remains fail-closed when no isolation provider exists; Git tools are excluded from the model's local execution catalog.

Write, command and package-tool grants bind to account, workspace and root identity. Exact approvals expire, are single-use, and recheck grants and inspected entry-file versions. Revoking execution or project writes cancels in-flight work and stops owned processes. Apps may access the network as normal local code; the package-download toggle controls the installation tools, not an OS network firewall.

A fixed native Windows process host creates children suspended, assigns a kill-on-close Job Object, and then resumes them. Stop, cancellation, timeout and backend exit terminate the child tree. Only selected standard handles are inherited. Environment variables are explicitly selected; backend/bridge secrets and Node injection settings are not copied. Actual stdout/stderr is bounded to 1 MB; persistent apps are limited per workspace and globally.

The EXE includes the installed npm CLI and its license. Its Electron Node runtime can run npm even without global Node. npm installs use the public npm registry, project prefix, no workspaces and disabled installation scripts. Python packages use PyPI wheels and a project target directory. Packages requiring source builds or install lifecycle scripts can fail and show their real error; no generic shell or elevation tool is provided. Python setup uses the exact WinGet `Python.Python.3.13` package, user scope, and shows acceptance of package/source terms in its approval.

Reference behavior: [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/), [pip install](https://pip.pypa.io/en/stable/cli/pip_install/), [WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install).

## Verification

Acceptance evidence is produced by the focused coding tests and disposable-project checks in `.qa/`: native checkpoint recovery and file search, real Python checks, real npm/PyPI downloads and imports, localhost readiness and process-tree shutdown, responsive UI controls, live Ollama coding, and the packaged Electron runtime. The QA Python interpreter is an explicit test override and is not a product dependency. No global Python installation is performed by these tests.

Final results:

- Focused coding suite: **56 passed, 0 failed** (`.qa/coding-agent-upgrade-tests.log`).
- Real installed `qwen2.5-coder:7b`: created two calculator files, passed Python compilation and **6 unittest cases**, with two exact approvals (`.qa/coding-calculator-live.log`).
- Real npm/PyPI installation, project Python import, npm script, Vite HTTP response and grant-revocation process shutdown passed (`.qa/coding-runtime-e2e.log`). A hidden Tkinter window and actual calculator button invocation passed, followed by native Stop (`.qa/coding-gui-smoke.log`).
- Browser checks passed at desktop and 530px widths: conversation, retry, approvals, source/diff, grants, Python-install UI, package UI, port selection, live logs, preview and Stop; no page errors (`.qa/coding-runtime-ui.log`). Runtime installation UI uses a fixture; global WinGet installation was not executed.
- Portable Electron **37.10.3 / Node 22.21.1** passed bundled npm install, npm-script Node shim without global Node in PATH, localhost HTTP and process Stop (`.qa/coding-runtime-packaged.log`). Packaged calculator completion passed real automatic unittest/syntax checks through two exact approvals (`.qa/coding-calculator-packaged.log`).
- Release `frontend/release-coding-runtime-20261025145456/win-unpacked/Chanakya AI.exe`: package source/integrity checks passed and no user storage was included. The final service source was refreshed into the unpacked backend after its last verification fix, then tested inside the EXE. Build and final package records are `.qa/coding-runtime-build-result.json` and `.qa/coding-runtime-final-package.log`.
