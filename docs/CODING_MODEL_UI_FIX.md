# Coding model discovery and compact UI — 25 October 2026

The coding workspace was mounted behind the shared 20-per-minute inference limiter. Runtime polling alone generated 24 requests per minute; task status polling added more. These reads exhausted the shared budget and blocked model discovery, approvals and Stop. The UI then described a failed model-list request as a lack of compatible installed models.

The coding router now applies inference admission only when creating a task or approving an action that resumes model inference. Authenticated model/status reads, cancellation, rejection and owned-process Stop stay available after that budget is exhausted. Authentication, root grants, ownership and exact command approvals remain enforced.

The UI now:

- Keeps the coding-model selector and Refresh button visible above the conversation, including at 436px width.
- Preserves the last successfully loaded model list/selection on a failed refresh; reports discovery errors separately from an empty compatible-model list and retries using Retry-After/backoff.
- Backs off task/runtime polling errors, and polls idle runtime state every 15 seconds while updating active tasks/processes more often.
- Keeps project settings collapsed unless opened or a project still needs connecting; edit permission has a compact Enable edits action. Project, context and folder controls remain in settings.
- Shows a compact welcome screen, Python/React suggestions and a visible composer, with the existing Chat/Code, source/diff, Run/packages and approval flows.

Validation records are in `.qa/coding-model-final-tests.log`, `.qa/coding-model-ui-check.log`, `.qa/coding-model-list-live.log` and `.qa/coding-model-packaged.log`. The production-router test makes 70 status reads, checks discovery still works, exhausts inference submissions, then confirms read/cancel/reject/Stop endpoints remain reachable while inference stays limited. Browser QA exercises initial 429 recovery, preserved selection after another failed refresh, 436px layout, settings, edit permission and the existing coding flows. The packaged test uses a disposable account/data directory and the real installed Ollama metadata, with no inference or user-project modification.

The focused suite passed **19/19** checks. Live metadata verified `qwen2.5-coder:7b`, `phi4-mini:latest`, `gemma4:e2b` and `qwen3.5:9b`. Desktop and 436px screenshots are `.qa/coding-model-ui-desktop.png` and `.qa/coding-model-ui-narrow.png`. No model installation or capability override was used.

The new portable release is `frontend/release-coder-ui-20261025152526/win-unpacked/Chanakya AI.exe`. Packaged Electron 37.10.3 passed 80 real HTTP status reads, live discovery of all four compatible models, enforcement of the inference submission limit, continued model-list access after that limit, and verification that the new model picker is present in its UI assets. Package integrity/source checks passed, and user storage was absent from the release. Exit the older app with Alt+F4 before opening this build.
