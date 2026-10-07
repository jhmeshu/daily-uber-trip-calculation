# Implementation Tasks — A23 Historical workbook import

**Plan:** `docs/tickets/A23-historical-workbook-import-plan.md`
**Ticket:** `docs/tickets/A23-historical-workbook-import.md`
**Branch:** `feature/historical-workbook-import` (from `main` @ `1102a71`)
**Execution:** sequential, one task per coder invocation, one commit per task

## Shared context every task needs

- Repo conventions: `AGENTS.md`, `.agents/rules/backend-development-rules.md` (twelve sacred invariants), `.agents/rules/typescript-style-rules.md`, `.agents/rules/git-guidelines.md`. Read them before editing.
- Ticket id to cite in any commit: **A23**.
- `exceljs@4.4.0` (MIT, pure JS, no native build) is the ONE permitted new dependency, server-only. Task 3 installs it.
- **Never stage runtime or personal artifacts:** `*.sqlite*`, `public/ocr/`, `dist/`, `test-results/`, `playwright-report/`, `.context/`. The owner's real workbook lives at `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/Uber Calculation 2026.xlsx` — it is **personal financial data**, it is gitignored, and it must **never** reach a commit or a test fixture.
- Every test that builds a `Store` uses `mkdtempSync`. Never point a test at the real data directory.
- Verification per task: `npm run typecheck` and `npm test` must be green. Do not claim a check you did not run.

## Dependency graph

```
Task 1  schema 4 end-to-end (migration + store + backup + docs)
   │
Task 2  src/shared/workbook.ts (pure shared domain)          ← no deps, parallel-safe with Task 1
   │
Task 3  server/workbook-container.ts (+ exceljs probe)
   │
Task 4  server/workbook.ts  (WorkbookImport class)
   │
Task 5  server/app.ts four route arms + cell() export + variance CSV
   │
Task 6  src/WorkbookImport.tsx + ImportPanel mount + style.css
   │
Task 7  src/Settings.tsx note + src/main.tsx Review missing fields
   │
Task 8  tests/workbook.spec.ts (Playwright) + full-suite verification
```

Batches are logical groupings only — this run dispatches **sequentially**, because every task runs `npm test` in one shared working tree and concurrent edits plus concurrent test runs produce misleading failures.

| # | Batch | Target file(s) | Agent | Depends on | Parallel with |
|---|---|---|---|---|---|
| 1 | 1 Schema | `server/migrations/004-workbook-import.sql`, `server/store.ts`, `server/backup.ts`, `docs/BACKUP-FORMAT.md` | backend | — | Task 2 |
| 2 | 1 Shared | `src/shared/workbook.ts`, `tests/workbook.test.ts` | backend | — | Task 1 |
| 3 | 2 Container | `server/workbook-container.ts`, `package.json`, lockfile | backend | 1, 2 | — |
| 4 | 2 Core | `server/workbook.ts`, `tests/workbook.test.ts` | backend | 3 | — |
| 5 | 2 Routes | `server/app.ts`, `src/shared/csv.ts`, `tests/workbook.test.ts` | backend | 4 | — |
| 6 | 3 Frontend | `src/WorkbookImport.tsx`, `src/ImportPanel.tsx`, `src/style.css` | frontend | 5 | — |
| 7 | 3 Frontend | `src/Settings.tsx`, `src/main.tsx` | frontend | 5 | Task 6 |
| 8 | 4 E2E | `tests/workbook.spec.ts` | frontend | 6, 7 | — |

Merge order is strictly 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Task 8 is the authoritative end-to-end gate.

---

## Task 1: Add schema version 4 with the three import tables and the v3→v4 restore path

**Assigned Agent:** backend-coder
**Dependencies:** None

### Description

Ship the schema bump end-to-end. A migration is never its own task — the `.sql` file, its registration in `server/store.ts`, the `BACKUP_TABLES` entry in `server/backup.ts`, and `docs/BACKUP-FORMAT.md` are one atomic change (invariant 10). Also add the `notify` flag to `Store.save()` that Task 4 depends on.

**1. Write `server/migrations/004-workbook-import.sql`** with three tables, packed style matching `server/migrations/003-evidence.sql` (no spaces inside `CHECK`, `STRICT` terminator, no `IF NOT EXISTS`, no `BEGIN`/`COMMIT` — `migrate()` at `server/store.ts:10-18` owns the transaction and the `PRAGMA user_version` bump):

- `import_sources` — `id TEXT PRIMARY KEY CHECK(length(id)=36)`, `filename TEXT NOT NULL`, `sha256 TEXT NOT NULL CHECK(length(sha256)=64)`, `bytes INTEGER NOT NULL CHECK(bytes>0)`, `detected_tabs TEXT NOT NULL CHECK(json_valid(detected_tabs))`, `imported_at TEXT NOT NULL`, `note TEXT NOT NULL`
- `import_rows` — `id TEXT PRIMARY KEY CHECK(length(id)=36)`, `source_id TEXT NOT NULL REFERENCES import_sources(id)`, `sheet_name TEXT NOT NULL`, `sheet_row INTEGER NOT NULL CHECK(sheet_row>0)`, `layout TEXT NOT NULL`, `raw_cells TEXT NOT NULL CHECK(json_valid(raw_cells))`, `mapped TEXT NOT NULL CHECK(json_valid(mapped))`, `disposition TEXT NOT NULL CHECK(disposition IN ('imported','skipped','needs_field'))`, `missing_fields TEXT NOT NULL CHECK(json_valid(missing_fields))`, `ride_id TEXT REFERENCES rides(id) ON DELETE SET NULL`, `reason TEXT NOT NULL`, `created_at TEXT NOT NULL`, `UNIQUE(source_id, sheet_name, sheet_row)`
- `import_variance` — `id TEXT PRIMARY KEY CHECK(length(id)=36)`, `source_id TEXT NOT NULL REFERENCES import_sources(id)`, `sheet_name TEXT NOT NULL`, `location TEXT NOT NULL`, `metric TEXT NOT NULL`, `workbook_reported TEXT`, `workbook_formula TEXT`, `app_value_paisa INTEGER`, `difference_paisa INTEGER`, `verdict TEXT NOT NULL CHECK(verdict IN ('match','variance','not_comparable','defect'))`, `note TEXT NOT NULL`, `created_at TEXT NOT NULL`
- Then `CREATE INDEX import_variance_source ON import_variance(source_id);` as its own statement.

House style notes: JSON columns are `TEXT NOT NULL CHECK(json_valid(col))`; enumerated text is `NOT NULL CHECK(col IN ('a','b'))`; timestamps are bare `TEXT NOT NULL` with **no** SQL-level format `CHECK` (format is enforced in code by `timestamp()` at `server/backup.ts:35` during restore).

**2. Register the migration** — append `'004-workbook-import.sql'` to the array literal at `server/store.ts:32`. Never edit `001`–`003`.

**3. Add `notify` to `Store.save()`** — `server/store.ts:53`. Add an optional trailing parameter `notify = true` and guard line `:72` (`this.afterSave?.(r)`) with `if (notify) …`. Every existing caller is unchanged. **Why:** `afterSave` is wired at `server/app.ts:26` to `evidence.finalize`, which runs an intake query per ride and writes one `field_decisions` row per non-null field with `origin:'manual'` (`server/evidence.ts:64-71`). Labelling 176 workbook-derived rows `'manual'` misrepresents provenance — the true record is `import_rows` — and it would add ~1,700 rows inside the commit transaction, every one carried in every later backup.

**4. `BACKUP_TABLES`** — `server/backup.ts:11`. Append `import_sources`, `import_rows`, `import_variance`. **They must come AFTER `'rides'` in the array.** `server/backup.ts:58` wipes with `[...BACKUP_TABLES].reverse()`, so reversed order must yield variance → rows → sources → … → rides. This is the only order satisfying `PRAGMA foreign_keys=ON` (`server/store.ts:31`) and the `PRAGMA foreign_key_check` at `backup.ts:60`. Wrong order fails **every** restore.

**5. Bump `schema_version` to 4 at four sites** — `server/app.ts:60` (`/api/health`), `server/backup.ts:15` (`BackupManifest`), `server/backup.ts:44` (`snapshot()`), and the check at `server/backup.ts:53`.

**6. Restructure the manifest check at `server/backup.ts:53`** so a v3 backup still restores (the owner's explicit requirement, A39). The current `Object.keys(manifest.tables).sort().join(',') !== [...BACKUP_TABLES].sort().join(',')` is an **exact-set equality** that rejects every 16-table v3 manifest the moment `BACKUP_TABLES` grows to 19. Restructure to:

1. Derive the allowed table set from `manifest.schema_version`: `4` → current `BACKUP_TABLES`; `3` → `BACKUP_TABLES` minus the three import names. Any other version → the existing `'Unsupported backup manifest.'` rejection.
2. Check `Object.keys(manifest.tables)` against that set with the same exact-equality semantics (unknown table still rejected).
3. Before the insert loop at `:59`, normalize a v3 manifest: set each missing import table to `[]`.

No row-level work is needed for the empty tables — the per-row column check at `:59` reads columns from the candidate v4 database via `PRAGMA table_info` (`:56`), so a zero-row table is never column-checked, and `foreign_key_check` (`:60`) is satisfied because nothing references them. **Unknown columns must still be rejected** — that is the `:59` comparison and must be preserved exactly.

**7. Update `docs/BACKUP-FORMAT.md:5,7`** — schema version 3 → 4, the table list 16 → 19 names, and any stated limit that changed.

### Acceptance Criteria

- [ ] `PRAGMA user_version` is `4` on a fresh store; the three tables exist with the exact columns and `CHECK` constraints above.
- [ ] `migrate()` still refuses a database newer than the app, and a failed migration still rolls back schema and version.
- [ ] `BACKUP_TABLES` has 19 names, the three new ones after `'rides'`; `PRAGMA foreign_key_check` is clean on a fresh v4 database.
- [ ] A **v3** manifest restores into v4 with the three new tables empty and all 16 original tables intact.
- [ ] A v4 manifest round-trips with the import records intact.
- [ ] An unknown table is rejected; an unknown column is rejected; a `schema_version` other than 3 or 4 is rejected.
- [ ] Injected `staged` / `before-activation` / `after-pointer` / `after-open` failures during a restore leave the original dataset active and intact (A40) — extend the existing loop at `tests/backup.test.ts:15`.
- [ ] `Store.save()` with the new 6th argument `false` writes the ride and its history event but creates no `field_decisions` rows; the default 5-argument form is unchanged for every existing caller.
- [ ] `/api/health` reports `schema_version: 4` — add an assertion, since no test currently covers it and the bump must not be silent.
- [ ] `npm run typecheck` and `npm test` green.

### Files

`server/migrations/004-workbook-import.sql` (new), `server/store.ts`, `server/backup.ts`, `server/app.ts`, `docs/BACKUP-FORMAT.md`, `tests/backup.test.ts`, `tests/storage-api.test.ts`

---

## Task 2: Create the pure shared workbook domain module

**Assigned Agent:** backend-coder
**Dependencies:** None

### Description

Create `src/shared/workbook.ts` — the pure, dependency-free workbook domain layer. **No `node:*` imports and no I/O**, or it breaks the Vite build. It imports only from `./domain.ts` and `./parser.ts`.

It exports:

**Layout constants.** `LAYOUT_A` / `LAYOUT_B` / `LAYOUT_C` as `as const` objects mapping each `RideInput` field to its column letter, plus `headerRow` (`1` for A and B, **`2`** for C). Use an `as const` array plus a derived union, never an `enum`.

| Field | Layout A (Oct/Sep/Aug) | Layout B (July) | Layout C (March) |
|---|---|---|---|
| `trip_date` / `pickup_time` / `duration_seconds` | `C` / `D` / `E` | `C` / `D` / `E` | `C` / `D` / `E` |
| `pickup_location` / `drop_location` / `distance_meters` | `F` / `G` / `H` | `F` / `G` / `H` | `F` / `G` / `H` |
| `cash_collected_paisa` | `I` | `I` | **absent** |
| `tips_paisa` | `J` | `J` | **absent** |
| `uber_credit_paisa` | `L` | **absent** | **absent** |
| `commission_paisa` | `O` (combined label) | `N` | `K` |
| `payment_method` / `service_type` | `N` / `M` | `M` / `L` | `J` / **absent** |
| `reported_net_paisa` | `P` | `O` | `L` |
| `comments` | `S` | `R` | **absent** |

`pass_charge_paisa` is **always** `null` — Layout A's `O` is a combined "Uber Comission / Pass" figure and splitting it by inference is forbidden (invariant 1, PRD §6).

**`WORKBOOK_PARSER_VERSION`** — a **separate** constant from `PARSER_VERSION` (`src/shared/parser.ts:3`). Reusing it would stamp workbook rows as OCR observations in `field_observations` (`server/evidence.ts:15`), which is false.

**Serial conversion** — `serialToLocalDate(serial)`, `serialToLocalTime(serial)`, `serialToDurationSeconds(serial)`. Excel 1900-system serials are days since 1899-12-30. Use **pure integer/fraction arithmetic**. **Never** `new Date(serial)` and never any `Date` constructor that applies UTC — a UTC-applying conversion can shift a trip onto the following day and silently corrupt a month boundary (invariant 8). Format `YYYY-MM-DD` and `HH:mm:ss` directly. Round a duration day-fraction to whole seconds. This is entirely greenfield — no serial helper exists anywhere in the repo.

**1900/1904 guard** — export `assertDateSystem(workbookXml: string)` (or an equivalent predicate) that **refuses** a workbook whose `xl/workbook.xml` carries `date1904`, rather than assuming.

**`mapCell(raw, kind)`** — the single conversion boundary, and the most correctness-critical function in the ticket.

- Placeholders `-`, `A/A`, `N/A`, blank and unparseable text return **`null`, never `0`** (invariant 1).
- `parseDecimal` (`src/shared/domain.ts:28`) **throws** on `-`, `A/A`, `N/A` and `12.68km` — it returns `null` only for empty input (`:30-33`). So the placeholder check happens **before** the call, with a `try`/`catch` mapping throw → `null` as a second layer. **Never** map a throw to `0`: `validateInput` (`:74-77`) accepts `0` as readily as `null`, so a `0` here is silently undetectable downstream. Follow the precedent at `src/shared/parser.ts:22`, which regex-captures only the numeric part before the suffix.
- Distance strips a trailing `km` then delegates to `parseDecimal(value, 3)`, so `12.68km` → `12680`.
- Money delegates to `parseDecimal(value, 2)`.
- Reuse `normalize()` (`src/shared/parser.ts:6`) for text fields — the `৳` and NBSP mappings matter even though the workbook has zero Bangla digits.

**Layout detection** — `detectLayout(headerCells)`. Locate the header row (`1` for A/B, `2` for C) and classify by header text. An unrecognised tab returns `unrecognised` and **zero rows** — never guessed at (invariant 7). `Cost Compare-Office with Uber-v` must classify as not a ride ledger.

**Ride-row detection** — a candidate row needs a parseable trip date **and** at least one of route, distance, or a financial value. `SL` alone is never sufficient — it is populated to row 77 on every tab. Detection stops at the first row after the last candidate, so the driver work log (which reuses columns `B`/`C`/`D` and runs past row 95) and the close-out block are excluded.

**`mapRow(cells, layout, timezone)` → `{ input: RideInput; missingFields: string[] }`** — spreads `blankRide()` (`src/shared/domain.ts:19`), then:

- forces `financial_basis: 'unresolved'` and `financial_confirmed: false` (R10);
- `pass_charge_paisa: null` always;
- `reported_net_paisa` carries the workbook's net as **evidence only** — never a receipt, deduction or income total (A32); `calculate()` (`domain.ts:96-107`) never reads it, so A32 is structural;
- `comments: ''` not `null` for Layout C — `validateInput:83-86` rejects `null` for text fields but allows `null` for `pickup_location`/`drop_location`;
- `payment_method` / `service_type` → `'Unknown'` when unrecognised;
- `timezone` from the **passed-in app setting**, not `blankRide()`'s `'Asia/Dhaka'` default (A47);
- `missingFields` lists the `financialFields` that are `null` — for Layout B that is `uber_credit_paisa`, for Layout C it is cash, credit and tips.

**`worksheetTotal(rows)`** — R9's recalculation. `calculate()` **cannot** be used literally: it returns `unresolved` when `financial_basis !== 'worksheet_cash_plus_credit'` (`domain.ts:97`) — and every imported row is forced to `unresolved` — and `incomplete` when any of the five amounts is `null` (`:98`) — and `pass_charge_paisa` is always `null`. So it yields a total for no tab at all. Implement:

- per row, a hypothetical worksheet-basis clone applying the **same formula** `cash + credit − commission − pass` then `− tips` (`domain.ts:100-101`, invariant 6);
- an amount that is `null` is **excluded** from that row's contribution, **not counted as zero** (invariant 1); count excluded fields per row and per tab;
- accumulate with **`BigInt`** across the tab, mirroring `summarize()`'s `BigInt` accumulation (`domain.ts:143-147`); convert to `Number` only at the display/CSV boundary;
- return `{ totalPaisa, comparable, rowsCounted, rowsExcluded, excludedFields, reason }` where `comparable` is false when nothing can be totalled or the exclusions make a total misleading — Layout C (March) is the canonical `not_comparable` case.

### Acceptance Criteria

- [ ] `serialToLocalDate`/`serialToLocalTime`/`serialToDurationSeconds` produce correct local values; a last-day-of-month fixture stays on that date and never shifts into the next month (A26); a day-fraction duration rounds to whole seconds.
- [ ] No `Date`-based serial arithmetic anywhere in the module; grep the diff to confirm.
- [ ] `assertDateSystem` refuses a 1904 workbook.
- [ ] `mapCell`: `12.68km` → `12680`; every placeholder, blank and unparseable value → `null` and **never** `0`, for distance, cash, credit, tips, commission and duration (A27).
- [ ] Layout A/B/C detected by header text; Layout C's header found at row 2; absent columns reported as absent rather than zero (A24); an unrecognised header → `unrecognised` and zero rows.
- [ ] Ride-row detection requires a date plus one corroborating signal; `SL` alone never qualifies; work-log rows below the ledger are excluded.
- [ ] `mapRow` yields `financial_basis:'unresolved'`, `financial_confirmed:false`, `pass_charge_paisa:null` (A31), the workbook net in `reported_net_paisa` only (A32), `comments:''` for Layout C, `timezone` from the argument (A47), and a correct `missingFields` list — `uber_credit_paisa` for Layout B, cash+credit+tips for Layout C (A30).
- [ ] Every `mapRow` output passes `validateInput()` from `src/shared/domain.ts:68`.
- [ ] `worksheetTotal` excludes absent amounts rather than zeroing them, accumulates with `BigInt`, returns `comparable:false` with a reason for Layout C, and for Layout A/B returns an exact integer-paisa total (A36).
- [ ] `npm run typecheck` and `npm test` green.

### Files

`src/shared/workbook.ts` (new), `tests/workbook.test.ts` (new — pure-function cases only; container and API tests come later)

---

## Task 3: Build the workbook container inspector and XLSX reader, and probe exceljs

**Assigned Agent:** backend-coder
**Dependencies:** Task 1, Task 2

### Description

**Step 0 — install and probe (do this first; the result shapes the rest of the task).** `npm install exceljs@4.4.0`. Then write a **throwaway** script (do not commit it) that reads `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/Uber Calculation 2026.xlsx` and dumps what `exceljs` reports for `October-2026` cells `K9`, `K10`, `K77` and `P78`.

Record the answer in a code comment and in this task's report. This is the ticket's **highest risk**: if `exceljs` expands a shared formula into per-cell formulas, October's 69 broken cells (master `K9` = `=I8-J8` over `K9:K77`) look individually self-row-correct and the defect becomes **invisible**, failing A33.

Then create `server/workbook-container.ts` exporting:

**`inspectContainer(buffer)` — inspect before parse (R2/R3/A41).** Read the ZIP central directory by hand, exactly as `archiveEntries()` does at `server/backup.ts:16-33`, and reject **before** handing anything to `exceljs` — `exceljs` does not defend against expansion.

Write a **sibling** reader; do not export or reuse `backup.ts`'s. `MAX_ARCHIVE`, `MAX_EXPANDED`, `MAX_ENTRIES` and `archiveEntries` are all module-private (`:14`, `:16`), and the allowlist regex at `:27` is backup-specific (`data.json` + `originals/<uuid>.<ext>`) so reusing it verbatim would reject every XLSX.

Caps: `MAX_WORKBOOK_BYTES = 25_000_000`, `MAX_EXPANDED = 512_000_000`, `MAX_ENTRIES = 10_000`, `MAX_SHEETS = 200`, `MAX_CELLS = 200_000`.

**Be precise about what "before buffering" means.** `binary()` (`server/intake-routes.ts:7-11`) enforces only the **compressed** cap, during streaming, before the body is buffered — that is the pre-buffering guarantee and it is real. Entry count, expanded bytes, worksheet count and non-empty-cell count are necessarily **post-buffer, pre-parse**, because they live in the central directory. That is the same ordering `backup.ts` uses. State this in comments and test names; do not imply all five caps are pre-buffer.

**Explicit unsafe-entry rejections.** `archiveEntries` blocks absolute paths, `..` segments, symlinks and directory entries only **implicitly**, via its name allowlist (`:27`) — there is no explicit check anywhere. An XLSX allowlist (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/worksheets/sheetN.xml`, `xl/sharedStrings.xml`, `xl/styles.xml`, …) would silently re-open all four, so add: `name.startsWith('/')`, a `..` path segment, a trailing `/` directory entry, and `(externalAttrs >>> 16) & 0xF000 === 0xA000` for symlinks. Also reject `flags & 1` (encryption), `method ∉ {0, 8}`, `expanded === 0xffffffff` (ZIP64), and the multipart/entry-count guards from `:20-21`.

**`readSheets(buffer)` → sheet name, ordered sheet XML, shared strings.** Use the already-present `fflate` (`server/backup.ts:1`) — no new library needed for the raw XML path.

**`sharedFormulaGroups(sheetXml)`** — the A33 lever. Extract `t="shared"`, `si`, `ref` and the master `<f>` text so the raw `si` → `ref` → master grouping is available. This is the **only** reliable way to detect the off-by-one. Use this path whether or not `exceljs` expands, if `exceljs` metadata proves insufficient — and prefer it when the probe shows expansion.

**`classifyFormulaGroups(groups)`** — for each shared-formula group, resolve the master's own row references and compare against the master's own row; a mismatch is a defect. Formulas are read as **text** and never evaluated (R7, invariant 7). Also classify: a formula referencing another tab (cross-tab carry-forward), a typed literal where a sibling tab holds a formula, and a formula containing embedded numeric literals.

### Acceptance Criteria

- [ ] `exceljs` in `dependencies` at `4.4.0`; the lockfile is updated; the Vite client output is unchanged (`exceljs` is imported only from `server/`).
- [ ] The probe result for `October-2026` `K9`/`K10`/`K77`/`P78` is recorded in a code comment, and the chosen read path is stated.
- [ ] A workbook over 25 MB compressed, over 512 MB expanded, over 10 000 entries, over 200 worksheets or over 200 000 non-empty cells is rejected **before** parsing (A41).
- [ ] A ZIP with an absolute path, a `..` segment, a symlink entry, a directory entry, encryption or ZIP64 is rejected (A41).
- [ ] `sharedFormulaGroups` recovers the `si`/`ref`/master grouping, and `classifyFormulaGroups` flags a master whose referenced row differs from its own row while leaving a self-row-correct group unflagged (A33).
- [ ] Cross-tab carry-forward, embedded numeric literals and typed-literal-where-sibling-has-formula are each classified (A34, A35).
- [ ] `assertDateSystem`-style detection refuses a 1904 workbook.
- [ ] Every rejection is a `ValidationError` from `src/shared/domain.ts:27` with a **hand-written** message. No interpolated path, no driver message. **Do not copy the shape at `server/backup.ts:80`** (`` `Backup validation failed: ${error.message}` ``) — that is exactly what A42 forbids.
- [ ] Tests build hostile ZIPs the way `tests/release.test.ts:7-11` does (it already hand-patches the raw central directory).
- [ ] `npm run typecheck` and `npm test` green.

### Files

`server/workbook-container.ts` (new), `package.json`, `package-lock.json`, `tests/workbook-container.test.ts` (new)

---

## Task 4: Implement the WorkbookImport class — preview, staged commit, and variance report

**Assigned Agent:** backend-coder
**Dependencies:** Task 3

### Description

Create `server/workbook.ts` exporting `class WorkbookImport`, mirroring the `Intake` / `Backups` shape: constructor takes what it needs, methods are plain, no HTTP concerns.

**Constructor** takes the `Store` (for the timezone setting, `store.list()`, and `transaction()`).

**Preview (R11).** Parse and validate **entirely in memory**; write nothing. Return per-tab detected layout, per-row disposition, mapped fields, missing fields, the per-tab recalculated total, and the defect/variance rows, plus an opaque `token` bound to the file's SHA-256. Reuse `hash` from `server/intake.ts:8` — do not re-implement SHA-256.

**Staging bounds are net-new code.** `Backups.pending` (`server/backup.ts:37`) is unbounded, never evicts, and only *checks* expiry at activate (`:83`). Implement max 5 concurrent, max 25 MB each, 30-minute expiry, pruned on **both** insert and access. In-memory-only satisfies "cleared on restart".

**Duplicate-workbook guard (R15).** At preview, if the file's SHA-256 matches an existing `import_sources` row, report that import's date and row count, and refuse the commit unless the owner passes `confirmed: true` with a reason — mirroring the `duplicate_decisions` model (`003-evidence.sql:14-17`, write path `server/evidence.ts:57`). Refusing silently is not acceptable; neither is importing twice without a trace.

**Pre-existing-ride warning (R16/A44).** **Do not call `evidence.candidates()`.** Three reasons, all from `server/evidence.ts:46-53`:

1. Its predicate is a **disjunction** (route **or** distance **or** amount); A44 specifies a **conjunction** of trip date, pickup time, distance and cash.
2. It matches only `status === 'reviewed'` rides (`:46`), so a second import of the same workbook would produce zero warnings.
3. It calls `this.store.list()` — a full unfiltered `SELECT * FROM rides` — plus one `trip_identifiers` query per ride. Per candidate row that is 176 full table scans inside the commit transaction.

Instead **reuse the comparison rules**: hoist `store.list()` and the `trip_identifiers` map once, then apply the A44 conjunction — date equal, time equal, `distance_meters` non-null on both sides and equal, `cash_collected_paisa` non-null on both sides and equal — against that snapshot. Comment that this is rule reuse, not function reuse. The warning does **not** block the commit (A44).

**Commit (R11/R12/A48).** One `store.transaction()` wrapping, per row: `validateInput(input)` then `store.save(input, 'draft', undefined, undefined, undefined, /* notify */ false)` — the sixth argument is Task 1's `notify` flag; **without it**, 176 `evidence.finalize` fan-outs run inside the transaction and mislabel every row `'manual'`. Then the `import_rows` record, then the `import_variance` records; plus the `import_sources` row.

- `transaction()` is re-entrant (`server/store.ts:38-40`), so the nested `save()` calls join the outer transaction.
- Any throw leaves **zero** rides, zero `import_rows`, zero `import_variance` (A48).
- A fresh `randomUUID()` per ride. Stable identity across a re-import comes from `import_rows`' `UNIQUE(source_id, sheet_name, sheet_row)` — **never** from workbook-derived ids.
- Re-validate every staged row server-side before writing. Never trust what the browser echoed (invariant 4).
- Nothing about the import may modify any existing ride.

**Report (R14/A36).** `report(sourceId?)` (default: most recent source) returns the variance rows plus per-tab summaries: the app-recalculated `income_excluding_tips` total in integer paisa, the workbook's stated total, the exact difference, the verdict (`match` / `variance` / `not_comparable` / `defect`), the reason, and the count of excluded absent amounts. **No tolerance** — a one-paisa difference is a variance. Where a cell's difference cannot be attributed to a specific row, say so rather than guessing an attribution.

Use the Task 2 `worksheetTotal()` helper — do not re-derive the income formula.

### Acceptance Criteria

- [ ] Preview writes **no** row to `rides` and changes no month total (A23).
- [ ] Preview reports six tabs; `Cost Compare-Office with Uber-v` is reported as not a ride ledger (A23).
- [ ] Staging bounds enforced: at most 5 concurrent, 25 MB each, 30-minute expiry, pruned on insert and access.
- [ ] The token is bound to the file's SHA-256; a token for a different file is rejected.
- [ ] Re-import of a matching SHA-256 is refused with the earlier import's date and row count reported; it proceeds only with `confirmed: true` plus a reason, which is persisted (A43).
- [ ] A candidate matching an existing reviewed ride on date + time + distance + cash is a **non-blocking** warning, and the commit still records the row as `imported` (A44).
- [ ] After commit every row is `status:'draft'`, `financial_confirmed:false`, `financial_basis:'unresolved'`, `revision:1`, `reviewed_at:null` (A28).
- [ ] Each ride gets a distinct `randomUUID()`, a `history` event, and an `import_rows` row linking `ride_id` to `sheet_name`/`sheet_row` (A47).
- [ ] `rides.data` for each imported ride passes `validateInput()`, and `timezone` equals the configured app setting (A47).
- [ ] Committing creates **zero** `field_decisions` rows — `notify:false` is actually passed.
- [ ] A failure injected on the **last** ride leaves zero rides, zero `import_rows` and zero `import_variance` for that source (A48).
- [ ] Financial and derived summary fields (`count`, `cash`, `credit`, `tips`, `deductions`, `including`, `excluding`, `distance_meters`) are identical before and after; `drafts` rises by exactly the imported count. `summarize()` counts drafts at `src/shared/domain.ts:152`, so `drafts` **is expected** to change — assert both facts rather than a blanket equality.
- [ ] The variance report contains the A33, A34 and A35 defect rows, and the A36 per-tab totals with exact differences and no tolerance.
- [ ] `npm run typecheck` and `npm test` green.

### Files

`server/workbook.ts` (new), `tests/workbook.test.ts`

---

## Task 5: Wire the four workbook routes, export cell(), and serve the variance CSV

**Assigned Agent:** backend-coder
**Dependencies:** Task 4

### Description

**1. Export `cell()` from `src/shared/csv.ts:3`.** It is currently module-private. R14 requires the variance CSV to reuse the injection guard and quoting rules from `cell()` — **export it and reuse it; do not duplicate it into a new module**, because divergence from the rides CSV's injection protection is exactly what A38 guards against. Adding the `export` keyword is additive and breaks nothing. **Do not touch `csvHeaders` (`:2`) or the `cell()` body (`:3-7`)** — A37 requires the rides CSV to stay byte-identical and `tests/domain.test.ts:52-58` asserts the exact BOM + header + escaping behaviour.

**2. Add the variance CSV builder** in `src/shared/workbook.ts` (or a sibling shared module) emitting its **own** frozen ten-column header: `source_sha256, sheet_name, location, metric, workbook_reported, workbook_formula, app_value_bdt, difference_bdt, verdict, note`. Named `uber-import-variance-<date>.csv`.

The `text` flag in `cell()` is **positional** in `exportCsv` (`csv.ts:16`): `app_value_bdt` and `difference_bdt` are machine-formatted (`text = false`); `workbook_reported`, `workbook_formula` and `note` are free text (`text = true`), so a quoted master formula `=I2-J2` correctly receives the `'` prefix. Byte contract to match: `'\uFEFF' + header + '\r\n' + rows.join('\r\n') + '\r\n'`.

**3. Wire four route arms inline in `server/app.ts`**, in the linear if-chain immediately after the restore arms (`:46-47`) and before the `/api/import` delegation at `:48`:

| Method + path | Behaviour |
|---|---|
| `POST /api/import/workbook/preview` | `await binary(req, MAX_WORKBOOK_BYTES)` → `workbook.preview(buffer)` |
| `POST /api/import/workbook/commit` | `exact(b, ['token','confirmed','reason'])`, then `confirmed !== true` → `ValidationError` |
| `GET /api/import/workbook/report` | `workbook.report(sourceId)` → `send(200, …)` |
| `GET /api/import/workbook/variance.csv` | raw `res.writeHead` + CSV |

**Why inline rather than a `workbook-routes.ts` module:** `exact()` is **module-private** in `server/app.ts:21`, so a delegating module would need it exported or duplicated. The delegation seam exists for `intake`, which has 14 routes; four more inline matches how every other family is handled and keeps the diff reviewable.

**Three consequences to handle deliberately:**

- `send()` is **JSON-only** (`server/app.ts:33`), so the variance CSV **cannot** use it. Mirror `/api/export` (`:62-69`) and `/api/backup` (`:45`): `res.writeHead` with `text/csv; charset=utf-8` plus `Content-Disposition`.
- `server/app.ts:41` returns **409** for any non-GET while a restore is staging, so workbook POSTs inherit that. This is correct — a commit during a restore would race a dataset swap. Keep it and cover it with a test.
- `exact(b, ['token','confirmed','reason'])` makes `reason` **required** on every commit, not just the duplicate path. That is the honest shape: the client always sends one (empty string when not a re-import) and R15's reason requirement needs no second code path.

Instantiate `WorkbookImport` alongside the existing `Intake` / `Evidence` / `Backups` wiring near `server/app.ts:26`.

### Acceptance Criteria

- [ ] Commit without `confirmed: true` → 400 with the existing `'Explicit confirmation is required.'` message shape (`app.ts:83`).
- [ ] A request body carrying any extra key — including a client-supplied total — → 400 via `exact()` (A29, invariant 4).
- [ ] The server recomputes every amount from the mapped primitives; no client-supplied value influences a stored figure.
- [ ] `GET /api/import/workbook/variance.csv` emits its ten-column header, UTF-8 BOM, CRLF endings, correct quoting, and a `'` prefix on any value beginning with `=`, `+`, `-` or `@` (A38).
- [ ] The response is `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="uber-import-variance-<date>.csv"`.
- [ ] `csvHeaders` unchanged; the existing rides CSV and its tests still pass untouched (A37).
- [ ] No response body contains a filesystem path, SQL text or a driver message; the 500 body is the existing fixed string (A42). The uploaded filename is never used to build a path and never appears in an error — **note `src/shared/intake.ts:12` interpolates `f.name`; do not copy that shape.**
- [ ] Loopback guards still hold on the new routes: foreign `Origin` → 403, forged `Host` → 403, `Sec-Fetch-Site: cross-site` → 403.
- [ ] A workbook commit during restore staging → 409.
- [ ] `npm run typecheck` and `npm test` green.

### Files

`server/app.ts`, `src/shared/csv.ts`, `src/shared/workbook.ts`, `tests/workbook.test.ts`, `tests/storage-api.test.ts`

---

## Task 6: Build the workbook import section in the Import screen

**Assigned Agent:** frontend-coder
**Dependencies:** Task 5

### Description

**1. Create `src/WorkbookImport.tsx`.** A self-contained section component so `ImportPanel`'s nine state variables stay untouched — the precedent is `ImagePreparation` at `src/ImportPanel.tsx:66`.

State: `busy`, `error`, `preview`, `committed`, `report`. Every async handler opens with `setError('')` and closes with `finally { setBusy(false) }`; every control gets `disabled={busy || …}`. Use `<p role="status">` for progress/notices and `<p role="alert" className="error-text">` for errors (`ImportPanel.tsx:52`).

Contents, per R18:

1. **File picker** — `<label className="drop-zone">Choose historical workbook<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose historical workbook" /></label>`. Visible label text and `aria-label` identical, matching `ImportPanel.tsx:50` so `getByLabel(…, {exact:true})` resolves. Accessibility is load-bearing — `tests/*.spec.ts` selects **only** by role and accessible name.
2. **Upload via raw `fetch` with no headers** — copy `ImportPanel.tsx:20-21`: `fetch('/api/import/workbook/preview', { method:'POST', body:file })`, then `if (!response.ok) throw new Error(result.error)`. A JSON-wrapped upload is impossible: `body()` (`server/app.ts:13`) requires `application/json` while `binary()` reads the raw stream.
3. **Preview table** inside `.table-wrap` — that wrapper's `overflow-x:auto` is what keeps 390 px free of horizontal overflow (`tests/browser.spec.ts:69` asserts `document.documentElement.scrollWidth <= window.innerWidth`). Give the `<table>` `aria-label="Workbook import preview"` so Playwright can select it by role + accessible name. Columns: tab, row, detected layout, mapped fields, missing fields, disposition.
4. **Per-tab variance list** with defect classifications rendered as **plain-language labels**, and verdict badges `<span className={`badge ${verdict}`}>` so the verdict word is present as **text**, not only as colour (A45).
5. **Commit control** guarded by `window.confirm()` naming the ride count — the `src/Settings.tsx:9` precedent — sending `{ token, confirmed: true, reason }`. Include a reason input for the re-import path, mirroring the explanation-field pattern at `src/EvidenceReview.tsx:18`.
6. **Past-import list** with the variance CSV download link.

**2. Mount as a sibling in `src/ImportPanel.tsx`** — render `<><WorkbookImport /><section className="panel import-panel">…</section></>`, keeping the existing panel **byte-identical**. Two reasons it must be a sibling, not nested:

- `validateBatch` (`src/shared/intake.ts:8-15`) rejects any non-image, and the `onDrop`/`onPaste` handlers at `ImportPanel.tsx:47` feed straight into `intake()`. Inheriting them would feed a dropped `.xlsx` to the image validator and surface "Use PNG, JPEG or WebP images".
- Keeping the existing panel untouched preserves every current `getByRole`/`getByLabel` selector in `tests/offline.spec.ts:10-11`.

**3. Append to `src/style.css`** — add `.badge.match`, `.badge.variance`, `.badge.not_comparable`, `.badge.defect` as dense one-line rules after line 7, plus a `.missing-fields` rule if needed. **Append only** — do not reformat lines 1-7, and do not add a media query beyond the existing `@media(max-width:760px)` at line 3.

### Acceptance Criteria

- [ ] The section appears on the Import screen with a heading and an accessible name; the existing screenshot panel is byte-identical.
- [ ] Uploading a workbook shows the preview table with tab, row, layout, mapped fields, missing fields and disposition.
- [ ] The variance list renders each defect classification as text and distinguishes an imported field, a missing field and an unknown verdict in text (A45).
- [ ] Commit is guarded by `window.confirm()`, sends `{ token, confirmed: true, reason }`, and reports the created ride count.
- [ ] The variance CSV download link appears for past imports.
- [ ] Every control is reachable and operable by keyboard and carries an accessible name.
- [ ] At 390 px there is no horizontal overflow.
- [ ] No new runtime dependency, and no component library or CSS framework.
- [ ] Existing e2e selectors still resolve — `npm run test:e2e` must not regress the existing specs.
- [ ] `npm run typecheck` green.

### Files

`src/WorkbookImport.tsx` (new), `src/ImportPanel.tsx`, `src/style.css`

---

## Task 7: Add the Settings backup note and the Review missing-fields affordance

**Assigned Agent:** frontend-coder
**Dependencies:** Task 5

### Description

**1. `src/Settings.tsx` — A39 note.** Add one static `<p className="muted">` inside the "Complete backup" block (`:7`), stating that the workbook import upgrades the schema to 4 and that backups taken before first use remain restorable, with a fresh backup advised anyway. `.muted` already exists in `src/style.css` and is used at `Settings.tsx:6`.

**Static text, not conditional.** Making it conditional would require adding `schema_version` to `/api/settings` — which currently returns `data_directory`, `root_directory`, `timezone` and `ocr` and **no** version — or a second fetch. Neither earns its keep for a one-time advisory.

**2. `src/main.tsx` — Review missing-fields affordance (A30).** `reviewErrors()` returns **generic prose**, not a per-field list (`src/shared/domain.ts:108-115`): "Review requires worksheet-basis receipts and all five known financial amounts." A30 wants the Review screen to show *exactly* which fields are empty.

The blocking half already works with no change: `reviewErrors()` returning a non-empty array gates `Save reviewed` at `src/main.tsx:190` on `review.length > 0`. For the display half, render a short missing-fields list in the Review form for rides whose `import_rows.missing_fields` is non-empty, reusing the `labels` map at `src/main.tsx:14` (`Cash collected`, `Uber credit`, `Tips included in receipts`, …) so the wording matches the form labels. `src/EvidenceReview.tsx:17` already has a `missing` / `manual` / `extracted` / `corrected` vocabulary to mirror.

**3. Do not touch the four-button nav at `src/main.tsx:165`.** PRD §9's five-screen structure and R18 both forbid a fifth screen, and `tests/offline.spec.ts:19` selects all four buttons by exact name.

### Acceptance Criteria

- [ ] Settings shows a note advising a fresh backup and stating that pre-upgrade backups still restore.
- [ ] Opening an imported July ride in Review shows `Uber credit` as empty and blocks `Save reviewed`; the same for an imported March ride showing cash, credit and tips empty (A30).
- [ ] The missing-fields text matches the form field labels.
- [ ] The nav still has exactly four buttons with unchanged accessible names; no existing e2e selector breaks.
- [ ] No new dependency; plain CSS only.
- [ ] `npm run typecheck` green.

### Files

`src/Settings.tsx`, `src/main.tsx`, possibly `src/style.css`

---

## Task 8: Write the Playwright import flow spec and run the full suite

**Assigned Agent:** frontend-coder
**Dependencies:** Task 6, Task 7

### Description

**1. Build a synthetic `.xlsx` fixture in the test**, written programmatically by emitting `xl/workbook.xml` + `xl/worksheets/sheetN.xml` directly and zipping with `fflate`'s `zipSync` (the `altered()` pattern at `tests/backup.test.ts:3` is the precedent for ZIP surgery in tests).

The real workbook is **personal financial data**, is gitignored, and must **never** be committed. The synthetic fixture reproduces exactly the structural defect classes the ACs need, with **zero real amounts, names, plates, routes or URLs**:

- Layout A / B / C tabs with their real header rows and column orders — March's header at **row 2**, July with no credit column, March with a single `Fare` column;
- the `K3:K7` and `K9:K77` shared-formula masters with `=I2-J2` / `=I8-J8`, **plus a self-row-correct sibling group** for contrast (A33);
- a `P78`-style cross-tab carry-forward referencing the identical ancestor cell (A34);
- embedded numeric-literal formulas and a typed literal where a sibling holds a formula (A35);
- text distances with a `km` suffix plus `-` and `A/A` placeholders (A27);
- a driver-work-log block below the ledger reusing the same columns (A25).

Writing the XML by hand also makes the shared-formula question directly testable, independent of whatever `exceljs` does.

If the real workbook is present at `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/Uber Calculation 2026.xlsx`, add a **skip-guarded** test asserting the genuine per-tab counts **2 / 38 / 68 / 63 / 5 = 176** (A25), the six-tab detection with `Cost Compare-Office with Uber-v` as not-a-ledger (A23), and the specific cells `K9`, `P78`, `O55`, `Q80`. Guard with `existsSync` so `npm test` stays green on a fresh clone with no `.context/`. **Report clearly that A23/A25 are verified locally against the real file but are not reproducible from the repo alone** — that limitation belongs in the final report, not hidden.

**2. `tests/workbook.spec.ts`.** Boot like `tests/offline.spec.ts:3`. Select **only** by role and accessible name. Use `setInputFiles({name, mimeType, buffer})` for the workbook picker.

Cover:

- pick the synthetic workbook → preview table appears with its accessible name → commit with `window.confirm` stubbed → ride count reported;
- the variance list renders defect classifications as text and distinguishes imported / missing / unknown (A45);
- a committed draft opens in Review with exactly its missing fields empty and `Save reviewed` blocked until filled (A30);
- the rides CSV still downloads with its A15 header unchanged (A37);
- the variance CSV downloads with its own ten-column header, BOM, and a `'` prefix on a formula-text value (A38);
- keyboard operability of picker, preview table, commit control and variance download (A45), and `document.documentElement.scrollWidth <= window.innerWidth` at 390 px;
- **with external requests forcibly aborted**, the full path — upload → preview → commit → review → save reviewed → dashboard → rides CSV → backup → restore — completes with no external request and no page error, and `exceljs` is absent from the Vite client output (A46). `tests/offline.spec.ts` is the model for aborting external requests.

**3. Run the full verification suite** and report the actual results:

```
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` runs real Tesseract OCR and takes minutes — do not skip it silently, and do not report a suite that was never run. A script that exists and fails **is** a failure.

### Acceptance Criteria

- [ ] `tests/workbook.spec.ts` covers every item above and passes.
- [ ] The committed fixture contains no real amounts, names, plates, routes or URLs.
- [ ] `npm test` passes on a tree with **no** `.context/` directory — the skip guard works.
- [ ] With the real workbook present locally, the real-layout test passes and reports 2/38/68/63/5.
- [ ] `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` all green, with real output quoted in the report.
- [ ] No existing spec regressed.

### Files

`tests/workbook.spec.ts` (new), `tests/fixtures/` if a fixture helper file is extracted
