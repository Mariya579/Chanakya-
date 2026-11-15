# Coding agent: raw file blocks — 27 October 2026

## Problem

The coding model had to return every action as one JSON object (Ollama `format` grammar), so a whole
file was escaped inside a JSON string. Output was capped at 2048 tokens (`contextWindow / 4` at the
default 8192 context). Medium files were cut off mid-JSON → `JSON.parse` failed → bounded repairs →
`MODEL_PROPOSAL_INVALID`, and no file was written. Updates also needed the model to copy a 64-character
SHA-256 `expectedVersion` exactly.

## Change (`backend/src/coding/CodingModelAdapter.js`)

- When `fs.write` is in the granted catalog, the model may write a file as a raw block (no escaping):

  ```
  <write_file path="src/app.py">
  ...file content...
  </write_file>
  ```

  `parseRawCodingReply` converts it to an ordinary `fs.write` proposal; `validateCodingProposal` and
  all workspace/approval checks run unchanged. A file block cannot add a tool that is not granted.
- Every other action is still one JSON object. Without the grammar the parser tolerates Markdown
  fences, a missing `kind`, extra commentary keys and raw newlines inside JSON strings.
- `expectedVersion` for `fs.write` / `fs.patch` is filled when missing or malformed, **only from
  server-observed versions** in the task history (`changedFiles`, `fs.read`/`fs.write` results);
  otherwise `new`. External edits after the observation still fail with `FILE_CONFLICT`.
- Output budget grows up to 4096 tokens when the prompt leaves room (6 KB history reserve, same
  conservative 2-bytes-per-token estimate); never below the previous limit. ≈3000 tokens at 8192.
- A cut-off block (`<write_file>` without `</write_file>`) is never written; the retry tells the
  model to write a smaller file or split it.
- `codingInferenceLimits` now accepts the adapter's `hardwareProfile`; production behaviour is the
  same (`getCachedHardwareProfile({ freeMemory })`), tests are deterministic.

Rollback: set `CODING_RAW_FILE_BLOCKS=0` in `backend/.env` to restore the JSON-only protocol.

## Tests

`node --test src/coding/CodingModelAdapter.test.js` — 20 passed (7 new). The two context tests that
depended on the real machine's GPU now use injected profiles. Other coding suites show the same
results before and after this change.

## Running project code

Unchanged: enable **Run & packages → Allow project commands** (off by default) and approve each
command; enable **Allow package downloads** for `deps.install`.
