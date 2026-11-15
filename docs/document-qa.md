# Document Q&A (Excel / CSV / PDF / DOCX / TXT / folders)

Upload files (or a whole folder) in **Documents** tab, then ask in chat.

## How it works

| Step                               | What happens                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload XLSX/CSV                    | Every sheet → header row auto-detected (title rows skipped) → every row stored in SQLite (`doc_tables`, `doc_rows`) + FTS5 keyword index. Rows embedded as `Column: value` text in LanceDB. |
| Upload DOCX                        | Text chunks + tables inside the document stored as real tables.                                                                                                                             |
| Upload PDF                         | Chunks tagged with page numbers (`[Page 3] ...`) so answers cite pages.                                                                                                                     |
| Upload TXT/MD                      | Text chunks.                                                                                                                                                                                |
| Question: "Ravi details?"          | Keyword (BM25) row lookup → rows with the most question keywords win → exact rows sent to LLM.                                                                                              |
| Question: "Chennai la ethana per?" | LLM writes a JSON plan (filters + count/list/sum/avg/min/max/group_count) → app executes it over **all** rows → exact COMPUTED RESULT sent to LLM.                                          |
| Any other question                 | Vector (LanceDB) + keyword (FTS5) chunks merged with Reciprocal Rank Fusion.                                                                                                                |

Code: `backend/src/docqa/` (tableParser, structuredStore, queryPlanner, retrieve, ingest). Tests: `node --test src/docqa/docqa.test.js`.

## Demo script (files in `demo-data/`)

Upload the `demo-data` folder with **Upload a whole folder**, then ask:

1. `Kavya Selvam details enna? enga irukaru, epa join panaru, entha company?` → 2 people with that name, both rows.
2. `EMP1124 yaaru?` → exact row by ID.
3. `Chennai la ethana per work panraanga?` → exact count over 520 rows.
4. `Chennai la Zoho la work panra ellarum list pannu` → filtered table.
5. `Company wise employee count kudu` → group count.
6. `Highest salary yaaru?` → max with row.
7. `2023 la join panavanga list` → year filter.
8. `Divya Krishnan entha project handle panraanga?` → DOCX table.
9. `Flight booking approval yaaru kitta vaanganum?` → PDF, page 2.
10. `Casual leave evlo days?` → TXT.

## Tips

- Use a model that follows JSON well for counts/lists (qwen3 / llama3 / mistral all work; qwen3 is best).
- Re-upload old Excel files once — files indexed before this feature have no row index.
- `.xls` (old Excel 97) is not supported: open in Excel → Save As `.xlsx`.
- Env knobs: `EMBED_BATCH_SIZE` (default 48), `DOCQA_CONTEXT_CHARS` (default 12000).
