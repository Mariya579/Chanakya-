# Document Intelligence Agent

Fully offline agent for PDF, Word, Excel, CSV, TXT and JSON inside Chanakya AI. It answers in the
existing chat (no new tab) and through a REST API. Exact data work (IDs, ranges, filters, sums) is done
by deterministic code over **every row of the real file**; the local model (Ollama) is used only to
explain, summarize or draft prose.

## Architecture (`backend/src/docintel/`)

| Component | File | Role |
| --- | --- | --- |
| DocumentTaskRouter | `router.js`, `agent.js#routeTask` | Deterministic English/Tamil/Tanglish parsing of the request into a task (range, lookup, aggregate, filter, group, duplicates, search, pages, summarize, explain, compare, convert, generate, edit, inspect) or a clarifying question. No model. |
| DocumentParser | `parser.js`, `formats.js`, `ocr.js` | One structured model for every format: sheets with real row numbers, header row, merged cells, formulas vs cached results; PDF pages (+ local OCR for scanned pages); DOCX headings/sections/lists/tables; JSON records. Validates extension, MIME label, file signature, ZIP container (zip bombs, unsafe paths, encryption), macros/external links (flagged, never run). |
| DocumentOperationEngine | `operations.js`, `values.js`, `compare.js` | Exact ID ranges (inclusive, missing/duplicate IDs, independent re-check), lookups, filters (number/date/text), stable sorting, grouping, duplicates, SUM/AVERAGE/COUNT/COUNTA/COUNTBLANK/MIN/MAX/MEDIAN/COUNTIF/SUMIF/AVERAGEIF, pagination, text search with page/section references, page ranges, document diff. Blanks, text, error cells and unsaved formula results are reported separately — never treated as 0. |
| DocumentGenerationEngine | `generation.js`, `conversion.js`, `edit.js`, `libreoffice.js` | XLSX (real SUM formulas + saved results), DOCX (header, page numbers, tables), PDF (Edge/Chrome or LibreOffice, A4, header, "Page X of Y"), CSV/JSON/TXT/MD/HTML; conversion registry with explicit source→target pairs; edits on copies (total row, formula column, Word find/replace scoped to a section). |
| DocumentVerificationEngine | `verify.js` | Re-opens every generated file with the matching parser: signature, row counts, headers, totals, expected text, table count. A download link is shown only when verification passes. |
| ResponseExplainer | `explainer.js` | Summaries/explanations (map→reduce for long files) with `[p.3]` / `[§ Section]` references; Tamil output on request; document text passed as untrusted data inside `<document>` tags. |
| Runtime / storage | `runtime.js`, `originals.js`, `stores.js` | Read-only original copies, parsed-document cache, result pages, jobs with progress/cancel. |

Integration points:

* **Upload** (`services/documentIngestionService.js`): after indexing, a read-only copy of the original is kept in
  `storage/docintel/originals/<documentId>/`. New upload formats: `.xlsm .xls .tsv .json .doc` (`.xls/.doc` need LibreOffice).
  Scanned PDFs are OCR'd locally instead of being rejected.
* **Chat** (`routes/chat.js`): exact document requests go to this agent first. Folder organizing, entity extraction,
  table cleaning/merging and upload-only turns stay with the existing file agent; open questions
  ("who joined in 2021?") still go to docqa retrieval and the model. Set `DOCINTEL_CHAT=0` to disable.
* **Delete** (`services/documentsStore.js`): deleting a document also deletes its stored original copy.
* **UI**: results render as normal chat tables; `#chanakya-output=<id>` links are authenticated download buttons and
  `#chanakya-docintel=<id>` opens a paged view of large results (`frontend/src/chat/DocIntelResultPager.jsx`).

## REST API (`/api/docintel`, bearer session required, owner-scoped)

| Method | Path | Body / query |
| --- | --- | --- |
| GET | `/capabilities` | formats, conversions, engines found (LibreOffice, pdftoppm, OCR languages), limits |
| GET | `/documents/:id` | inspect: sheets, header rows, column types, pages, sections, warnings |
| POST | `/documents/:id/search` | `{ query, column?, exact?, sheet?, page?, pageSize? }` |
| POST | `/documents/:id/range` | `{ from, to, column?, sheet?, page?, pageSize? }` |
| POST | `/documents/:id/filter` | `{ conditions: [{column, op, value, value2?}], sort?: [{column, direction}], sheet?, page?, pageSize? }` |
| POST | `/documents/:id/aggregate` | `{ fn, column?, criteria?, sheet? }` |
| POST | `/documents/:id/group` | `{ by: [..], aggregates: [{fn, column}], sheet? }` |
| POST | `/documents/:id/duplicates` | `{ columns?, sheet? }` |
| POST | `/documents/:id/pages` | `{ from, to? }` |
| POST | `/tasks` | `{ message, documentIds }` → 202 job (natural-language request) |
| POST | `/convert` | `{ documentId, target }` → 202 job |
| POST | `/generate` | `{ format, spec: {title, blocks} or {title, sheets} }` → 202 job |
| GET / POST | `/jobs/:id`, `/jobs/:id/cancel` | progress `{percent, message}`, result, error |
| GET | `/results/:id?page=&pageSize=` | pages of a large chat result (kept 2 h) |

Downloads: existing `GET /api/file-agent/outputs/:id` (authenticated, owner-only).

Filter ops: `eq ne gt gte lt lte between contains not_contains starts ends empty not_empty in date_between date_before date_after date_on`.

## Supported conversions

| From | To |
| --- | --- |
| PDF | TXT, MD, DOCX (text + detected tables; layout not reproduced), JSON, XLSX/CSV (detected tables) |
| DOCX | PDF (LibreOffice keeps layout; without it a rebuilt PDF via Edge/Chrome), TXT, MD, HTML, JSON, XLSX/CSV (tables) |
| DOC | DOCX, PDF (LibreOffice required), TXT, MD, JSON |
| XLSX / XLSM / XLS / CSV / TSV | CSV (one file per sheet), JSON, XLSX (from CSV/TSV/XLS), PDF report, DOCX, HTML |
| JSON / TXT / MD | DOCX, PDF, HTML, TXT/MD; JSON records → XLSX/CSV |

Anything else is rejected with the list of supported targets. Files are never "converted" by renaming.

## Retention

| Data | Where | Kept |
| --- | --- | --- |
| Original copy (chat attachment) | `storage/docintel/originals/` | 7 days or until the document is deleted |
| Original copy (knowledge base / workspace) | same | 30 days or until deleted |
| Generated files | `storage/file-agent/outputs/` | 7 days |
| Paged results / jobs | memory | 2 h / 1 h after finishing |

## Optional local tools (detected automatically, never downloaded)

* **LibreOffice** — DOCX/DOC→PDF with layout, legacy `.xls/.doc`, formula recalculation (only for workbooks whose formulas
  use an allowlist of safe functions; WEBSERVICE, INDIRECT, HYPERLINK, external workbooks are never evaluated).
  Override path: `CHANAKYA_SOFFICE=C:\Program Files\LibreOffice\program\soffice.exe`.
* **OCR** — `tesseract.js` with `backend/storage/ocr/eng.traineddata.gz` (add `tam.traineddata.gz` for Tamil).
  Page images come from Poppler `pdftoppm` (`CHANAKYA_PDFTOPPM`) or, for typical scanner PDFs, from the embedded JPEG pages.
* **Edge / Chrome** — PDF rendering with correct Tamil shaping.

Other settings: `DOCINTEL_MAX_FILE_MB` (25), `DOCINTEL_MAX_OCR_PAGES` (30), `DOCINTEL_CHAT` (1).

## Tests

`npm test` runs everything. Document Intelligence tests: `backend/test/docintel/*.test.mjs` (fixtures are generated at
test time) and `backend/tests/docintelChat.e2e.test.mjs` (real upload + chat routes, fake Ollama).
Set `DOCINTEL_TEST_OCR_DIR` to a folder with `eng.traineddata.gz` to run the real OCR test elsewhere
(it runs automatically when `backend/storage/ocr` has the file).
