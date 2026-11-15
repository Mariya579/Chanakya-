# File / document agent — 27 October 2026

Runs inside the existing chat. No new tab: attach files (or name a folder) and ask.

| Ask (examples) | What happens | Output |
|---|---|---|
| *(upload files, no message)* | Documents: whole-document summary. Excel/CSV: data profile (rows, duplicates, empty cells, column stats) | `.md` summary |
| "summarize" / "சுருக்கமாக சொல்லு" / "summarize as Word/PDF" | Map → reduce over **every** chunk (not only retrieved ones) | `.md` / `.docx` / `.pdf` |
| "remove duplicates", "clean this data", "merge these files", "filter Status = Paid and export to Excel", "total Amount by Region as excel" | Model proposes a JSON plan of operations; JavaScript executes it (exact numbers) | `.xlsx` (+ `.csv`, `.pdf`, `.docx` when asked) |
| "make a PDF report" / "create a Word document" | Report from the data (profile + tables) or from the document summary | `.pdf` / `.docx` / `.xlsx` |
| "convert to Excel / CSV / PDF / Word / Markdown / text / JSON" | Tables → spreadsheet; text → document | requested format |
| "extract emails and phone numbers", "extract tables", "extract dates / amounts / links" | Regex extraction with context | `.xlsx` (+ preview) |
| "organize D:\Downloads by type", "… by month", "find duplicate files in …", "rename files in … with date", "clean file names in …" | Read-only plan in chat → **Apply** → **Undo** | moves inside the folder only |

Ordinary questions about attachments ("what is the Q3 total?") still use docqa retrieval.

## Files

- `backend/src/fileagent/` — `intent.js` (routing), `tableOps.js` + `planner.js` (plan → exact execution),
  `summarize.js`, `extract.js`, `writers.js` (CSV, XLSX), `documents.js` (DOCX, HTML → PDF),
  `organize.js` (plan/apply/undo), `outputs.js`, `index.js` (agent), `runtime.js` (wiring), `fileagent.test.js`.
- `backend/src/routes/fileAgent.js` — `GET /api/file-agent/outputs/:id`, `GET|POST /api/file-agent/plans/:id[/apply|/undo]`.
- Hooks: `routes/chat.js` (before docqa retrieval; organize requests skip desktop automation),
  `app.js`, `docqa/structuredStore.js` (`getAllDocumentChunks`).
- Frontend: `chat/FileAgentLink.jsx` (download / Apply / Undo buttons from `#chanakya-…` links),
  `chat/RichMessage.jsx`, `services/api.js` (`fileAgent`, `status` stream event), `stores/useAppStore.js`.

## Notes

- No new npm dependency. XLSX/DOCX are written directly; verified with `read-excel-file` and `mammoth`.
- PDF uses Microsoft Edge (or Chrome) headless from the PC (`CHANAKYA_PDF_BROWSER` overrides the path),
  so Tamil is shaped correctly. Without a browser the agent returns an `.html` file to print.
- Generated files: `<appData>/storage/file-agent/outputs`, owner-only, removed after 7 days.
- Folder plans: valid 1 hour, only move/rename inside the chosen folder, never delete; drive roots, the user
  profile root, system folders and the app's own data folder are refused. Undo moves files back and removes
  only the empty folders the plan created.
- Uploaded originals are still deleted after indexing; the agent works from the stored text and every table row.
  Converting keeps text and tables, not original layout or images.
