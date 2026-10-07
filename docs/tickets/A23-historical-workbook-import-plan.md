# Implementation Plan — A23

**Ticket:** `docs/tickets/A23-historical-workbook-import.md`
**Type:** Feature
**Title:** Historical workbook import with in-app recalculation and variance reporting
**Generated:** 2026-10-08
**Branch:** `feature/historical-workbook-import` (from `main` @ `1102a71`)
**Base / mode:** `main` · `per-ticket` · `push: none`

---

## Summary

Add an end-to-end historical workbook import: upload a multi-tab `.xlsx`, inspect the ZIP container against hard caps before parsing, detect which of the three verified ledger layouts each tab uses, detect real ride rows (excluding the driver work log and close-out blocks), convert Excel serials by pure arithmetic, commit every row as an unconfirmed draft inside one transaction, and produce a per-cell variance report that names the workbook's known-bad formulas instead of copying them into the ledger.

The work spans a new migration (`schema_version` 3 → 4), a new server module, a new shared pure module, four new routes, one new React section in the existing Import screen, and `node:test` + Playwright coverage. Exactly one new runtime dependency is permitted: `exceljs`, server-side only.

Two findings from the code analysis change the deliverable's naive reading and are resolved in this plan rather than left to implementation:

1. **`calculate()` cannot be used literally for R9's recalculation.** `calculate()` returns `unresolved` when `financial_basis !== 'worksheet_cash_plus_credit'` (`src/shared/domain.ts:97`) and `incomplete` when *any* of the five amounts is `null` (`:98`). Every imported row is forced to `unresolved` (R10) and `pass_charge_paisa` is **always** `null` by the field mapping. So a literal `calculate()` yields a total for **no** tab. R9 needs a new shared helper that applies the same formula while *excluding* absent amounts rather than treating them as zero — see [R9 resolution](#r9-resolution-recalculation-over-absent-fields).
2. **A28's "identical" needs one carve-out.** `summarize()` counts drafts (`domain.ts:152`), so `/api/dashboard`'s `summary.drafts` **will** rise by 176 after a commit. Every financial and derived field (`count`, `cash`, `credit`, `tips`, `deductions`, `including`, `excluding`, `distance_meters`) is genuinely unchanged. See [A28 clarification](#a28-clarification).

## Affected Components

| Layer | File | Why |
|---|---|---|
| Schema | `server/migrations/004-workbook-import.sql` (new) | `import_sources`, `import_rows`, `import_variance` per R13 |
| Schema wiring | `server/store.ts:32` | invariant 10 — append the migration filename to the array |
| Store | `server/store.ts:53` (`save`) | new optional `notify` flag so the import can skip the `afterSave` evidence fan-out |
| Backup | `server/backup.ts:11,15,44,53` | `BACKUP_TABLES` + the `schema_version` 3 hardcodes and the v3→v4 restore path (A39) |
| Docs | `docs/BACKUP-FORMAT.md:5,7` | schema version 4 and the three new table names (A39) |
| Shared domain | `src/shared/workbook.ts` (new) | layout types, serial→local conversion, cell mapping, `worksheetTotal()` (R4/R5/R6/R9) |
| Shared domain | `src/shared/csv.ts:3` | export `cell()` so the variance CSV reuses one injection guard (R14, A38) |
| Server | `server/workbook.ts` (new) | container inspection, XLSX read, shared-formula grouping, staging map, transactional commit, variance assembly |
| HTTP route | `server/app.ts:46-47` (adjacent), `:60` | four new `/api/import/workbook/*` arms; `schema_version: 4` in `/api/health` |
| Panel | `src/WorkbookImport.tsx` (new) | the Import-screen section (R18, A45) |
| Panel | `src/ImportPanel.tsx:47` | mount the new section as a sibling **before** the screenshot panel |
| Panel | `src/Settings.tsx:7` | A39 "take a fresh backup" note |
| Panel | `src/main.tsx:181-190` | missing-fields affordance in the Review form (A30) |
| Styles | `src/style.css` | append `.badge.match` / `.variance` / `.not_comparable` / `.defect` + preview styles |
| Tests | `tests/workbook.test.ts` (new) | synthetic `.xlsx` fixture builder + pure/API coverage |
| Tests | `tests/backup.test.ts` | extend for the v3→v4 restore path (A39) and A40 |
| Tests | `tests/workbook.spec.ts` (new) | Playwright: upload → preview → commit → review → CSV |

## Proposed Implementation

Build order is bottom-up: schema → shared domain → server module → routes → frontend → tests. Each step is independently committable.

### Server Changes

#### S1. Migration `004-workbook-import.sql`

Write the three tables exactly as R13 specifies, matching the packed style of `server/migrations/003-evidence.sql` (no spaces inside `CHECK`, `STRICT` terminator, no `IF NOT EXISTS`, no `BEGIN`/`COMMIT` — `migrate()` at `server/store.ts:10-18` owns the transaction and the `PRAGMA user_version` bump).

Per-column requirements that the existing style already establishes:

- `TEXT NOT NULL CHECK(json_valid(col))` for JSON columns; `CHECK(col IS NULL OR json_valid(col))` for the nullable one.
- Enumerated text as `NOT NULL CHECK(col IN ('a','b'))` — matches `003-evidence.sql:11`, no lookup table.
- Timestamps as bare `TEXT NOT NULL` with no format `CHECK` — the format is enforced in code by `timestamp()` (`server/backup.ts:35`) at restore time. Do **not** add SQL-level timestamp validation.
- `id TEXT PRIMARY KEY CHECK(length(id)=36)` — required because restore double-enforces it with `requireId(row.id)` (`server/backup.ts:59`).
- `UNIQUE(source_id, sheet_name, sheet_row)` as an inline table-level constraint, mirroring `003-evidence.sql:6`.

**Critical delete-order constraint:** `server/backup.ts:58` wipes with `[...BACKUP_TABLES].reverse()`. `import_rows.ride_id` references `rides(id)`, so the three new names must be appended **after** `'rides'` in `BACKUP_TABLES`. Reversed, that yields variance → rows → sources → … → rides, which is the only order satisfying `PRAGMA foreign_keys=ON` (`server/store.ts:31`) and the `PRAGMA foreign_key_check` at `backup.ts:60`. Getting this wrong fails **every** restore, not just the import.

Add one index after the tables, per `001-initial.sql:26` style: `CREATE INDEX import_variance_source ON import_variance(source_id);` — `import_variance` is the table read on every report request.

Second required edit: append `'004-workbook-import.sql'` to the array literal at `server/store.ts:32`. Never edit `001`–`003`.

#### S2. `schema_version` 3 → 4, and the v3 → v4 restore path (A39)

`schema_version` is hardcoded in **four** sites and one of them blocks the required upgrade path:

| Site | Current | Change |
|---|---|---|
| `server/app.ts:60` | `schema_version: 3` in `/api/health` | → `4` |
| `server/backup.ts:15` | `BackupManifest … schema_version: 3` | → `4` |
| `server/backup.ts:44` | `snapshot()` writes `schema_version: 3` | → `4` |
| `server/backup.ts:53` | `manifest.schema_version!==3` + exact table-set equality | restructure (below) |
| `docs/BACKUP-FORMAT.md:5,7` | prose version 3, 16-name list, limits | → 4, 19 names |

`backup.ts:53`'s `Object.keys(manifest.tables).sort().join(',') !== [...BACKUP_TABLES].sort().join(',')` is an **exact-set equality**: the instant `BACKUP_TABLES` grows to 19, every existing 16-table v3 manifest is rejected. Restructure into a version-conditional:

1. Derive the allowed table set from `manifest.schema_version`: `4` → the current `BACKUP_TABLES`; `3` → `BACKUP_TABLES` minus the three import names. Reject any other version with the existing `'Unsupported backup manifest.'` message.
2. Check `Object.keys(manifest.tables)` against that set with the same exact-equality semantics (unknown table → reject).
3. Normalize before the insert loop at `:59`: for each of the three import tables absent from a v3 manifest, set `manifest.tables[name] = []`.

No row-level work is needed for the empty tables: the per-row column check at `:59` reads columns from the **candidate v4 database** via `PRAGMA table_info` (`:56`), so a table with zero rows is never column-checked, and `PRAGMA foreign_key_check` (`:60`) is satisfied because nothing references them.

Unknown **columns** in a v3 or v4 manifest must still be rejected — that behaviour is the column comparison at `:59` and must be preserved exactly.

#### S3. `server/store.ts` — a `notify` flag on `save()`

`save()` (`server/store.ts:53-80`) is the right write path — it calls `validateInput()` (`:54`), sets `revision` 1 for a new ride (`:65`), writes `reviewed_at: null` for a draft (`:67`), and writes the `history` row via `event()` (`:71`). `transaction()` is re-entrant (`:38-40`), so wrapping 176 `save()` calls in one outer `store.transaction()` gives A48's all-or-nothing.

But `save()` calls `this.afterSave?.(r)` at `:72`, wired at `server/app.ts:26` to `evidence.finalize`. `finalize()` (`server/evidence.ts:64-71`) runs `view()` → `sync()` (an intake-table query) per ride, then writes one `field_decisions` row per non-null field with `origin: 'manual'`.

Add an optional trailing parameter `notify = true` and guard `:72` with `if (notify) this.afterSave?.(r);`. Every existing caller is unchanged.

**Why the import must pass `notify: false`:** `field_decisions.origin` is `CHECK(origin IN ('extracted','corrected','manual'))` (`003-evidence.sql:9`). Labelling 176 workbook-derived rows `'manual'` misrepresents their provenance in a feature whose entire purpose is provenance. The true provenance record is `import_rows` (sheet name, sheet row, `raw_cells`, `mapped`, `disposition`, `missing_fields`), linked by `import_rows.ride_id`. Skipping `finalize` also avoids ~176 extra intake queries and ~1,700 extra rows inside the commit transaction, every one of which would then be carried in every subsequent backup.

#### S4. `src/shared/workbook.ts` (new) — pure, dependency-free, no `node:*`

Imported by the server only, but it must live in `src/shared/` per `AGENTS.md` if the preview UI is to render mapped-field labels from the same source. It must contain no `node:*` import or it breaks the Vite build.

Contents:

- **Layout constants.** `LAYOUT_A` / `LAYOUT_B` / `LAYOUT_C` as `as const` objects mapping each `RideInput` field to its column letter per DEL-01 §3.2, plus `headerRow` (`1` for A/B, `2` for C). Derived union types, no `enum` — required for anything crossing the JSON boundary.
- **`WORKBOOK_PARSER_VERSION`** — a **separate** string from `PARSER_VERSION` (`src/shared/parser.ts:3`). Reusing `PARSER_VERSION` would stamp workbook rows as OCR observations in `field_observations` (`server/evidence.ts:15`), which is false.
- **`serialToLocalDate(serial)`, `serialToLocalTime(serial)`, `serialToDurationSeconds(serial)`** — pure integer/fraction arithmetic, **never** `new Date(serial)` and never any `Date` constructor that applies UTC (R6). Excel serials are days since 1899-12-30 in the 1900 system; implement the day offset with integer arithmetic and format `YYYY-MM-DD` / `HH:mm:ss` directly. Round a duration day-fraction to whole seconds. This is entirely greenfield — no serial helper exists anywhere in the repo (the analyst confirmed this).
- **1900/1904 guard.** Refuse a workbook whose `xl/workbook.xml` carries `date1904`, rather than assuming (deliverable §9.1).
- **`mapCell(rawText | number | null, kind)`** — the single conversion boundary. Placeholders `-`, `A/A`, `N/A`, blank and unparseable text return **`null`**, never `0` (A27, invariant 1). Distance strips a trailing `km` before delegating to `parseDecimal(value, 3)` (`src/shared/domain.ts:28`), which yields 12680 metres for `12.68km`.

  **`parseDecimal` throws on placeholders — it does not return `null` for them** (`domain.ts:30-33`: it returns `null` only for empty input and throws for anything non-numeric). So the placeholder check must happen **before** the call, and a `try`/`catch` mapping throw → `null` is the belt-and-braces second layer. Never map a throw to `0`: `validateInput` (`:74-77`) accepts `0` as readily as `null`, so a `0` here is silently undetectable downstream. Follow the existing precedent at `src/shared/parser.ts:22`, which regex-captures only the numeric part before the suffix.
- **`looksLikeRideRow(...)` / ride-row detection** (R5): a candidate needs a parseable trip date **and** at least one of route, distance, or a financial value. `SL` alone is never sufficient — it is populated to row 77 on every tab. Stop at the first row after the last candidate so the work log and close-out block are excluded.
- **`mapRow(cells, layout)` → `{ input: RideInput; missingFields: string[] }`** — spreads `blankRide()` (`domain.ts:19`), forces `financial_basis: 'unresolved'`, `financial_confirmed: false`, `payment_method`/`service_type` to `'Unknown'` when unrecognised, applies `cleanLocation()` (though `validateInput` at `:90` applies it again defensively — harmless), `comments` to `''` not `null` (Layout C has no comments column and `validateInput:83-86` rejects `null` for text fields), and `timezone` to the **app setting** rather than `blankRide()`'s `'Asia/Dhaka'` default (A47). `pass_charge_paisa` is always `null`. `reported_net_paisa` carries the workbook's net as **evidence only**.
- **`worksheetTotal(rows)`** — see [R9 resolution](#r9-resolution-recalculation-over-absent-fields).

#### S5. `server/workbook.ts` (new) — `class WorkbookImport`

Mirrors the `Intake` / `Backups` shape: constructor takes what it needs, methods are plain async, no HTTP concerns.

- **Container inspection, before parsing (R2/R3, A41).** `MAX_ARCHIVE = 25_000_000`, `MAX_EXPANDED = 512_000_000`, `MAX_ENTRIES = 10_000`, `MAX_SHEETS = 200`, `MAX_CELLS = 200_000`. Read the ZIP central directory by hand — the same ordering as `archiveEntries()` (`server/backup.ts:16-33`) — **before** handing anything to `exceljs`, because `exceljs` does not defend against expansion.

  Write a **sibling** reader rather than exporting `backup.ts`'s: `MAX_*` and `archiveEntries` are module-private, and the allowlist regex at `backup.ts:27` is backup-specific (`data.json` + `originals/<uuid>.<ext>`). Reusing it verbatim would reject every XLSX.

  **A41 wording vs reality:** `binary()` (`server/intake-routes.ts:7-11`) enforces only the **compressed** cap, during streaming, before the body is buffered — that is the pre-buffering guarantee and it is real. Entry count, expanded bytes, worksheet count and non-empty-cell count are necessarily **post-buffer, pre-parse**, because they live in the central directory. Say this plainly in code comments and in the test names rather than implying all five caps are pre-buffer.

  The backup reader blocks absolute paths, `..` segments, symlinks and directory entries only **implicitly**, via its name allowlist (`backup.ts:27`) — there is no explicit check anywhere. An XLSX allowlist (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/worksheets/sheetN.xml`, `xl/sharedStrings.xml`, `xl/styles.xml`, …) would silently re-open all four, so add **explicit** rejections: `name.startsWith('/')`, a `..` path segment, a trailing `/` directory entry, and `(externalAttrs >>> 16) & 0xF000 === 0xA000` for symlinks. Also reject `flags & 1` (encryption), `method ∉ {0, 8}`, and `expanded === 0xffffffff` (ZIP64), plus the multipart/entry-count guards from `backup.ts:20-21`.

- **XLSX read + shared-formula grouping (R7, A33).** This is the ticket's highest risk. `exceljs` may expand a shared formula into per-cell formulas, which would make October's 69 broken cells (`K9:K77`, master `K9` = `=I8-J8`) look individually self-row-correct and **hide the defect entirely**.

  Make the first sub-task a **probe**: install `exceljs`, read the real workbook, and dump what it reports for `October!K9`, `K10` and `K77` and for `October!P78`. Record the answer in the commit message and in a code comment. Then choose one path and state which:

  - **Preferred if `exceljs` expands:** read `xl/worksheets/sheetN.xml` directly with the already-present `fflate`, extracting `t="shared"`, `si`, `ref` and the master `<f>` text. The raw `si` → `ref` → master grouping is the **only** reliable way to detect the off-by-one. `fflate` is already a dependency (`server/backup.ts:1`), so no new library is needed for this.

  Either way, classification is: for each shared-formula group, resolve the master's own row references and compare with the master's own row; a mismatch is a defect. Formulas are read as **text** and never evaluated (R7, invariant 7).

- **Layout detection (R4).** Locate the header row (`1` for A/B, `2` for C) and classify by header text. An unrecognised tab is reported `unrecognised` and skipped — never guessed at. `Cost Compare-Office with Uber-v` must be reported as *not a ride ledger* (A23).

- **Preview (R11).** Parse and validate entirely in memory; write nothing. Return per-tab layout, per-row disposition, mapped fields, missing fields, the per-tab recalculated total and the defect/variance rows, plus an opaque `token` bound to the file's SHA-256.

  Staging bounds are **net-new** — `Backups.pending` (`backup.ts:37`) is unbounded, never evicts, and only *checks* expiry at activate (`:83`). Implement max 5 concurrent, max 25 MB each, 30-minute expiry, pruned on both insert and access. In-memory-only satisfies "cleared on restart".

  SHA-256 reuses `hash` from `server/intake.ts:8` — do not re-implement.

- **Duplicate-workbook guard (R15).** At preview, if the file's SHA-256 matches an existing `import_sources` row, report that import's date and row count and refuse the commit unless the owner sends `confirmed: true` with a reason, mirroring the `duplicate_decisions` model (`003-evidence.sql:14-17`, write path `evidence.ts:57`). Refusing silently is not acceptable; neither is importing twice without a trace.

- **Pre-existing-ride warning (R16/A44).** **Do not call `evidence.candidates()`.** Three reasons, all from `server/evidence.ts:46-53`:
  1. Its predicate is a **disjunction** (route **or** distance **or** amount); A44 specifies a **conjunction** of trip date, pickup time, distance and cash.
  2. It matches only `status === 'reviewed'` rides (`:46`), so a second import of the same workbook would produce zero warnings.
  3. It calls `this.store.list()` — a full unfiltered `SELECT * FROM rides` — plus one `trip_identifiers` query per ride. Per candidate row that is 176 full table scans inside the commit transaction.

  Instead **reuse the comparison rules**: hoist `store.list()` and the `trip_identifiers` map once, then apply the A44 conjunction (date equal, time equal, `distance_meters` non-null on both sides and equal, `cash_collected_paisa` non-null on both sides and equal) against that snapshot. Note in a comment that this is rule reuse, not function reuse.

- **Commit (R11/R12).** Body `{ token, confirmed, reason }` via `exact()`; `confirmed !== true` rejected exactly like `server/app.ts:82-83`. Re-validate every staged row server-side before writing — never trust what the browser echoed. One `store.transaction()` wrapping, per row: `validateInput(input)` then `store.save(input, 'draft', undefined, undefined, undefined, /* notify */ false)`, then the `import_rows` record, then the `import_variance` records; plus the `import_sources` row. Any throw leaves zero rides and zero `import_rows`/`import_variance` (A48). A fresh `randomUUID()` per ride — stable identity across re-import comes from `import_rows`' `UNIQUE(source_id, sheet_name, sheet_row)` (R13), never from workbook-derived ids.

  Ignore any total present in the request body (A29, invariant 4). `exact()` makes an unknown key a 400 anyway.

- **Report + variance CSV (R14).** `GET /api/import/workbook/report?source_id=…` (default: most recent) returns variance rows plus per-tab summaries. `GET /api/import/workbook/variance.csv?source_id=…` emits a **separate** ten-column CSV with its own frozen header, named `uber-import-variance-<date>.csv`.

  The variance CSV **cannot use `send()`** — it is JSON-only (`server/app.ts:33`). Mirror `/api/export` (`app.ts:62-69`) and `/api/backup` (`:45`): `res.writeHead` with `text/csv; charset=utf-8` + `Content-Disposition`.

  Export `cell()` from `src/shared/csv.ts:3` and reuse it rather than duplicating the guard into a new module — divergence from the rides CSV's injection protection is exactly the bug A38 guards against. The `text` flag is **positional** in `exportCsv` (`:16`); the variance CSV must decide per column: `app_value_bdt` and `difference_bdt` are machine-formatted (`text = false`), while `workbook_reported`, `workbook_formula` and `note` are free text (`text = true`) — so a quoted master formula `=I2-J2` correctly receives the `'` prefix. Byte contract to match: `'\uFEFF' + header + '\r\n' + rows.join('\r\n') + '\r\n'`.

#### S6. `server/app.ts` — four new arms

Wire them inline in the linear if-chain immediately after the restore arms (`:46-47`) and before the `/api/import` delegation at `:48`. This is deliberate over a `workbook-routes.ts` module:

- `exact()` is **module-private** in `app.ts:21`. A delegating module would need it exported or duplicated.
- The delegation seam exists for `intake`, which has 14 routes; four more routes inline matches how every other family (`/api/settings`, `/api/rides`, sessions) is handled and keeps the diff small and reviewable.

Arms:

| Method + path | Behaviour |
|---|---|
| `POST /api/import/workbook/preview` | `await binary(req, MAX_WORKBOOK_BYTES)` → `workbook.preview(buffer)` |
| `POST /api/import/workbook/commit` | `exact(b, ['token','confirmed','reason'])`, `confirmed !== true` → `ValidationError` |
| `GET /api/import/workbook/report` | `workbook.report(sourceId)` → `send(200, …)` |
| `GET /api/import/workbook/variance.csv` | raw `res.writeHead` + CSV stream |

Two consequences to decide and record:

- `server/app.ts:41` returns **409** for any non-GET while a restore is staging. Workbook POSTs will inherit that. This is correct — a commit during a restore would be racing a dataset swap — but state it in the plan and cover it with a test.
- `exact(b, ['token','confirmed','reason'])` makes `reason` **required** on every commit, not just the duplicate path. That is the honest shape: the client always sends one (empty string when not a re-import), and R15's reason requirement needs no second code path.

Also bump `/api/health`'s `schema_version` to `4` (`:60`). No test currently asserts it; add one in S7 so the bump is not silent.

#### R9 resolution: recalculation over absent fields

`calculate()` cannot serve R9 as written. It returns `unresolved` for `financial_basis !== 'worksheet_cash_plus_credit'` (`domain.ts:97`) — and R10 forces every imported row to `unresolved` — and `incomplete` if any of the five amounts is `null` (`:98`) — and `pass_charge_paisa` is **always** `null` by the field mapping. A literal `calculate()` therefore produces a total for no tab at all.

`worksheetTotal(rows)` in `src/shared/workbook.ts`:

- Per row, build a hypothetical worksheet-basis clone and apply the **same formula** `cash + credit − commission − pass` then `− tips` (`domain.ts:100-101`, invariant 6).
- An amount that is `null` is **excluded** from that row's contribution, not counted as zero (invariant 1). Count the excluded fields per row and per tab.
- Accumulate with **`BigInt`** across the tab, mirroring the `BigInt` accumulation already used inside `summarize()` (`domain.ts:143-147`). Convert to `Number` only at the display/CSV boundary.
- Verdict per tab:
  - **`not_comparable`** when no row can be totalled at all, or when the excluded-field count makes a total misleading — March, which has no cash, credit or tips columns, is the canonical case. Carry a human-readable reason.
  - **`match`** when the difference is exactly `0` paisa.
  - **`variance`** otherwise, **with no tolerance** (A36): a one-paisa difference is a variance.

The report must show, per tab: the app-recalculated total in integer paisa, the workbook's stated total, the exact difference, the verdict, the reason, and the count of excluded absent amounts — so the reader can see what was left out. Where a cell's difference cannot be attributed to a specific row, say so rather than guessing an attribution (R9).

### Frontend Changes

#### F1. `src/WorkbookImport.tsx` (new component)

A self-contained section so `ImportPanel`'s nine state variables stay untouched — the precedent is `ImagePreparation` at `src/ImportPanel.tsx:66`.

State: `busy`, `error`, `preview`, `committed`, `report`. Every async handler opens with `setError('')` and closes with `finally { setBusy(false) }`; every control gets `disabled={busy || …}`. `role="status"` for progress/notices, `role="alert" className="error-text"` for errors (`ImportPanel.tsx:52`).

Contents, per R18:

1. File picker — `<label className="drop-zone">Choose historical workbook<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose historical workbook" /></label>`. Visible label text and `aria-label` identical, matching `ImportPanel.tsx:50` so `getByLabel(..., {exact:true})` resolves.
2. Upload via **raw `fetch`** with no headers — copy `ImportPanel.tsx:20-21`: `fetch('/api/import/workbook/preview', { method:'POST', body:file })`, then `if (!response.ok) throw new Error(result.error)`. A JSON-wrapped upload is impossible: `body()` (`app.ts:13`) requires `application/json` and `binary()` reads the raw stream.
3. Preview table in `.table-wrap` (`overflow-x:auto` is what keeps 390 px free of horizontal overflow — `tests/browser.spec.ts:69` asserts `document.documentElement.scrollWidth <= window.innerWidth`), with `aria-label="Workbook import preview"` on the `<table>` so Playwright can select it by role + accessible name. Columns: tab, row, detected layout, mapped fields, missing fields, disposition.
4. Per-tab variance list with the defect classifications as **plain-language labels**, and verdict badges `<span className={`badge ${verdict}`}>` so the verdict word is present as text, not only as colour (A45).
5. Commit control guarded by `window.confirm()` naming the ride count — the `Settings.tsx:9` precedent — sending `{ token, confirmed: true, reason }`. A reason input for the re-import path, mirroring `EvidenceReview.tsx:18`'s explanation field.
6. Past-import list with the variance CSV download link.

#### F2. `src/ImportPanel.tsx` — mount as a sibling, before the screenshot panel

Render `<><WorkbookImport /><section className="panel import-panel">…</section></>`, keeping the existing panel **byte-identical**. Two reasons this must be a sibling rather than nested:

- `validateBatch` (`src/shared/intake.ts:8-15`) rejects any non-image, and the `onDrop`/`onPaste` handlers at `ImportPanel.tsx:47` feed straight into `intake()`. Inheriting them would feed a dropped `.xlsx` to the image validator and surface "Use PNG, JPEG or WebP images".
- Keeping the existing panel untouched preserves every current `getByRole`/`getByLabel` selector in `tests/offline.spec.ts:10-11`.

#### F3. `src/main.tsx` — Review-form missing-fields affordance (A30)

`reviewErrors()` returns **generic prose**, not a per-field list (`domain.ts:108-115`): "Review requires worksheet-basis receipts and all five known financial amounts." A30 wants the Review screen to show *exactly* which fields are empty.

`reviewErrors` blocking `Save reviewed` (`src/main.tsx:190` gates on `review.length > 0`) already satisfies the second half of A30 with no change. For the first half, render a short missing-fields list in the Review form for rides whose `import_rows.missing_fields` is non-empty, reusing the `labels` map at `main.tsx:14` (`Cash collected`, `Uber credit`, `Tips included in receipts`, …) so the wording matches the form labels. `EvidenceReview.tsx:17` already has a `missing` / `manual` / `extracted` / `corrected` vocabulary to mirror.

Leave the four-button nav at `main.tsx:165` completely untouched — PRD §9's five-screen structure and R18 both forbid a fifth screen, and `tests/offline.spec.ts:19` selects all four by exact name.

#### F4. `src/Settings.tsx` — A39 note

Add one static `<p className="muted">` inside the "Complete backup" block (`:7`), stating that the workbook import upgrades the schema to 4 and that backups taken before first use remain restorable, with a fresh backup advised anyway. `.muted` already exists in `style.css` and is used at `Settings.tsx:6`.

Static text, not conditional — making it conditional would require adding `schema_version` to `/api/settings` (it currently returns `data_directory`, `root_directory`, `timezone`, `ocr` and no version) or a second fetch. Neither earns its keep for a one-time advisory.

#### F5. `src/style.css` — append only

Add `.badge.match`, `.badge.variance`, `.badge.not_comparable`, `.badge.defect` as dense one-line rules appended after line 7, plus a `.missing-fields` rule if F3 needs one. Do not reformat lines 1-7 or introduce a media query beyond the existing `@media(max-width:760px)` at line 3.

## Invariants At Risk

| # | Invariant | How the design protects it |
|---|---|---|
| 1 | Blank is not zero | `mapCell` returns `null` for every placeholder and unparseable cell, with the placeholder check **before** `parseDecimal` (which throws). `worksheetTotal` excludes absent amounts rather than summing them as zero. **This is the invariant most likely to be violated silently**, because `validateInput` accepts `0` as readily as `null`. |
| 2 | Integer paisa, `BigInt` | All conversion goes through `parseDecimal(value, 2)` / `parseDecimal(value, 3)`; tab totals accumulate in `BigInt` inside `worksheetTotal`, mirroring `summarize()` (`domain.ts:143-147`). |
| 3 | Reviewed-only income | R10 forces `status:'draft'`, `financial_confirmed:false`, `financial_basis:'unresolved'` on every row. Combined with `summarize()`'s filter (`domain.ts:141`), imported rows contribute nothing to income. |
| 4 | Server is authoritative | Commit calls `validateInput()` per row server-side and re-validates every staged row; `exact()` rejects any unknown key, so a client-supplied total is a 400 rather than a silent ignore. |
| 5 | Financial edits invalidate confirmation | Every imported row lands `financial_confirmed:false`, and `financialSignature()` (`domain.ts:93-95`) distinguishes `null` from `0`, so filling a missing amount changes the signature and cannot inherit a confirmation. |
| 6 | Income formula | `worksheetTotal` applies the identical formula; `pass_charge_paisa` is always `null` and is never split out of the combined commission/pass figure by inference (A31, PRD §6). |
| 7 | The parser never invents | An unrecognised tab is reported `unrecognised` and skipped. Formulas are read as text and never evaluated. No year, no balance and no cash/credit split is inferred. `WORKBOOK_PARSER_VERSION` is separate from `PARSER_VERSION`. |
| 8 | Local dates, no carry-forward | Serial conversion is pure arithmetic, never a UTC-applying `Date`. No opening/closing/carried balance enters the ledger — this is the spreadsheet-side reading of the invariant, and A34 asserts it. |
| 9 | Exact inputs, optimistic concurrency | `exact()` on the commit body; `requireId()` on `source_id`; `confirmed !== true` rejected. |
| 10 | A migration is two edits | `004-workbook-import.sql` **and** the `store.ts:32` array append. Released migrations untouched. `BACKUP_TABLES` + `docs/BACKUP-FORMAT.md` updated (A39). |
| 11 | Transactional multi-step writes | One `store.transaction()` around all 176 rides + `import_rows` + `import_variance` + `import_sources` (A48). `transaction()` is re-entrant (`store.ts:38-40`), so nested `save()` calls join the outer transaction. |
| 12 | Storage lifecycle | The workbook is read, parsed and discarded — no bytes retained, no new file class in `attachments`, no second copy of the owner's financial data on disk. |

Security invariants: the loopback guards are untouched; limits are enforced before buffering (compressed) and before parsing (central directory); the container reader rejects absolute paths, `..`, symlinks, directory entries, encryption and ZIP64 explicitly; and no response interpolates a path, SQL text or driver message — `ValidationError` with hand-written messages only. **Note:** `server/backup.ts:80` currently interpolates (`` `Backup validation failed: ${error.message}` ``) and `src/shared/intake.ts:12` interpolates `f.name`. Do not copy either shape; `exportCsv`'s numeric columns are also a reminder that driver messages must never reach a body.

## A28 clarification

`summarize()` (`src/shared/domain.ts:141-153`) computes `drafts` as the count of `status === 'draft'` (`:152`). After a 176-ride commit, `/api/dashboard`'s `summary.drafts` **will** rise by 176. Every other field — `count`, `cash`, `credit`, `tips`, `deductions`, `including`, `excluding`, `distance_meters` — is genuinely unchanged, because the financial fields filter on `status === 'reviewed' && reviewErrors(r).length === 0` (`:141`).

The A28 assertion is therefore written as: all financial and derived summary fields identical before and after, **and** `drafts` incremented by exactly the number of imported rides. This is the honest reading of "summary values are identical" and it is strictly stronger than ignoring the draft count. Flagged here because it is the one place the implementation must not take the ticket's wording literally.

## Edge Cases & Risks

1. **`exceljs` expands shared formulas → the defect becomes invisible.** The single highest risk (R7/A33). Mitigation: probe first and record the answer; prefer raw `xl/worksheets/sheetN.xml` via `fflate` with `t="shared"` / `si` / `ref` / master `<f>` text. A33 fails if the grouping is not detected.
2. **`BACKUP_TABLES` ordering breaks every restore.** The reversed-delete at `backup.ts:58` requires the three new names **after** `'rides'`. A wrong order fails all restores, not just the import — verify with an explicit `PRAGMA foreign_key_check` test.
3. **The `backup.ts:53` exact-set equality blocks the v3→v4 path** the owner explicitly asked for (Q3/A39). Highest-risk single edit in the ticket.
4. **A `throw` → `0` mapping anywhere in the parser** is undetectable downstream because `validateInput` accepts `0`. Covered by A27's explicit null assertions.
5. **Work-log rows imported as rides.** R5's multi-signal row detection plus a row-range stop; A25 asserts the exact per-tab counts 2/38/68/63/5.
6. **A merged balance range (`Q2:Q78`) mistaken for the closing balance.** The close-out block is out of scope by R4/R5 and is only ever reported by address, never read as a value.
7. **Evidence fan-out inside the commit.** Mitigated by the `notify:false` flag (S3); without it, ~1,700 `field_decisions` rows labelled `'manual'` would misstate provenance and bloat every later backup.
8. **Per-row `store.list()` cost.** `evidence.candidates()` would mean 176 full table scans inside the transaction; hoisted per R16.
9. **A41 wording.** Only the compressed cap is pre-buffer; the other four are pre-parse. Test names and comments must not overclaim.
10. **Commit racing a restore.** Inherits the 409 at `app.ts:41`. Intended; test it.
11. **Test fixture availability.** See [Testing](#testing) — the exact-count assertions need the real workbook, which is gitignored personal data and must never be committed.
12. **1904 workbooks.** Must be detected and refused, not silently misread (deliverable §9.1).
13. **`parseDecimal` overflow.** `12.68km` → `12680`; a hostile `99999999999999999999km` must surface a `ValidationError`, not `Infinity`.

## Testing

Follow existing conventions: flat top-level `test()` calls in `tests/*.test.ts` (no `describe()`), `mkdtempSync` roots, never the real data directory. Titles carry the acceptance id.

### Fixture strategy

The real workbook lives in gitignored `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/` and **must never be committed**. Two-tier fixtures:

1. **A committed synthetic `.xlsx`, built programmatically in the test** by writing `xl/workbook.xml` + `xl/worksheets/sheetN.xml` directly and zipping with `fflate`'s `zipSync`. This is the primary fixture and it is fully deterministic. It reproduces exactly the structural defect classes the ACs need:
   - Layout A / B / C tabs with their real header rows and column orders (March's header at row 2, July with no credit column, March with a single `Fare` column);
   - the `K3:K7` and `K9:K77` shared-formula masters with `=I2-J2` / `=I8-J8` and a self-row-correct sibling group for contrast (A33);
   - `P78`-style cross-tab carry-forward referencing the identical ancestor cell (A34);
   - embedded numeric-literal formulas and a typed literal where a sibling holds a formula (A35);
   - text distances with a `km` suffix plus `-` and `A/A` placeholders (A27);
   - a driver-work-log block below the ledger reusing the same columns (A25);
   - **zero real amounts, names, plates, routes or URLs.**

   Writing the XML by hand also makes R7's shared-formula question directly testable, independent of whatever `exceljs` does.

2. **A real-workbook test that skips when the file is absent** — asserts the genuine per-tab counts (2/38/68/63/5 = 176, A25), the six-tab detection including `Cost Compare-Office with Uber-v` as not-a-ledger (A23), and the specific cells `K9`, `P78`, `O55`, `Q80`. Guard with `existsSync(...)` and `t.skip()` / an early return so `npm test` stays green on a fresh clone with no `.context/`. Report clearly that A23/A25 are verified locally against the real file but are **not** reproducible from the repo alone.

Follow `tests/release.test.ts:7-11` for container-rejection tests (it already hand-patches the raw ZIP central directory) and `tests/backup.test.ts:3` `altered()` for archive surgery.

### Domain tests — `tests/workbook.test.ts`

- `serialToLocalDate` / `serialToLocalTime` / `serialToDurationSeconds`: correct local values; a last-day-of-month fixture stays on that date and never shifts into the next month (A26); a duration day-fraction rounds to whole seconds; a 1904 workbook is refused.
- `mapCell`: `12.68km` → `12680`; `-` / `A/A` / `N/A` / blank / prose → `null`, **never `0`**, for distance, cash, credit, tips, commission and duration (A27).
- Layout detection: A/B/C classification, March's header at row 2, absent columns reported as absent rather than zero (A24), an unrecognised tab → `unrecognised` and zero rows (invariant 7).
- `mapRow`: every row yields `financial_basis:'unresolved'`, `financial_confirmed:false`, `pass_charge_paisa:null` (A31), `reported_net_paisa` set as evidence only (A32), `comments:''` for Layout C, `timezone` from the app setting (A47), and a correct `missing_fields` list (A30).
- `worksheetTotal`: absent amounts excluded, not zeroed; `BigInt` accumulation; `not_comparable` for March with a reason; a one-paisa difference yields `variance`, not `match` (A36).
- Shared-formula grouping: the off-by-one master is detected and classified; a self-row-correct group is not flagged (A33).

### API tests — `tests/workbook.test.ts` / `tests/storage-api.test.ts`

Boot with the `tests/storage-api.test.ts:47-51` pattern (`mkdtempSync` + `createApp` + `listen(0,'127.0.0.1')` + read `address().port`).

- Preview: six tabs, layouts detected, `Cost Compare` not a ledger, **zero** rows written to `rides` and no month-total change (A23).
- Commit without `confirmed:true` → 400; with it → ride count; a client-supplied total in the body → 400 via `exact()` (A29).
- After commit: 176 rows all `draft` / `financial_confirmed:false` / `financial_basis:'unresolved'` / `revision:1` / `reviewed_at:null`; financial summary fields unchanged and `drafts` +176 (A28); each ride has a distinct `randomUUID`, a history row, and an `import_rows` row linking `sheet_name`/`sheet_row`; `rides.data` passes `validateInput()` (A47).
- Transactional rollback: inject a failure on the **last** ride → zero rides, zero `import_rows`, zero `import_variance` (A48).
- Container caps: over-25 MB compressed, over-512 MB expanded, over-10 000 entries, over-200 worksheets, over-200 000 cells; absolute path, `..` segment, symlink entry, directory entry, encryption, ZIP64 — all rejected before parsing; a workbook with no recognisable header → 400 naming the tab and the columns found (A41).
- Re-import: matching SHA-256 refused with the earlier import's date and row count; proceeds only with `confirmed:true` + reason (A43).
- Pre-existing match: a candidate matching an existing reviewed ride on date + time + distance + cash is a **non-blocking warning** and the commit still records the row `imported` (A44).
- No response body contains a path, SQL text or a driver message; the 500 body is the fixed string (A42).
- Guards still hold: foreign `Origin` → 403, forged `Host` → 403, `Sec-Fetch-Site: cross-site` → 403; a workbook commit during restore staging → 409.
- `/api/health` reports `schema_version: 4` (new — the bump must not be silent).

### Backup tests — `tests/backup.test.ts`

- `BACKUP_TABLES` has 19 names with the three new ones **after** `'rides'`; `PRAGMA foreign_key_check` is clean on a fresh v4 database.
- A **v3** manifest restores into v4 with the three new tables empty and all 16 original tables intact (A39).
- A v4 manifest round-trips with import records intact.
- An unknown table and an unknown column are both still rejected.
- Injected `staged` / `before-activation` / `after-pointer` / `after-open` failures during a restore involving the three new tables leave the original dataset active and intact (A40, via the existing `tests/backup.test.ts:15` loop).

### E2E — `tests/workbook.spec.ts`

Boot like `tests/offline.spec.ts:3`. Select **only** by role and accessible name. Use `setInputFiles({name, mimeType, buffer})` for the workbook picker.

- Pick the synthetic workbook → preview table appears with an accessible name → commit with `window.confirm` stubbed → ride count reported.
- The variance list renders defect classifications as text and distinguishes an imported field, a missing field and an unknown verdict (A45).
- A committed draft opens in Review with exactly its missing fields shown empty and `Save reviewed` blocked until they are filled (A30).
- The rides CSV still downloads with its A15 header unchanged (A37).
- The variance CSV downloads with its own ten-column header, BOM and `'` prefix on a formula-text value (A38).
- Keyboard operability of the file picker, preview table, commit control and variance download (A45); `document.documentElement.scrollWidth <= window.innerWidth` at 390 px.
- With external requests aborted: upload → preview → commit → review → save reviewed → dashboard → rides CSV → backup → restore, with no external request and no page error; `exceljs` absent from the Vite client output (A46).

## Acceptance Criteria

Mirrors the ticket's A23-A48. Deviations from a literal reading are marked.

- [ ] **A23** Six tabs detected from the real workbook; `Cost Compare-Office with Uber-v` not a ride ledger; preview writes no row and changes no month total.
- [ ] **A24** Layout A for October/September/August, B for July, C for March with header at row 2; absent columns reported absent, not zero.
- [ ] **A25** Exactly 2/38/68/63/5 rides; zero work-log, close-out or allocation rows. *Real-count assertions run against the real workbook and skip when it is absent.*
- [ ] **A26** Serials convert to correct local date/time/whole seconds; no month-boundary shift; no UTC-applying `Date` path.
- [ ] **A27** `12.68km` → 12680; every placeholder/unparseable value → `null`, never `0`.
- [ ] **A28** All imported rows `draft` / `financial_confirmed:false` / `financial_basis:'unresolved'` / `revision:1` / `reviewed_at:null`; financial and derived summary fields identical, `drafts` +176. *(Clarification above.)*
- [ ] **A29** Commit without `confirmed:true` → 400; with it → ride count; server recomputes and ignores any body total.
- [ ] **A30** July reports `uber_credit_paisa` missing, March reports cash/credit/tips missing; Review shows exactly those fields empty; `reviewErrors()` blocks review.
- [ ] **A31** `pass_charge_paisa` always `null`; non-zero combined cells flagged "commission/pass combined — pass share unknown"; no split by inference.
- [ ] **A32** Net stored in `reported_net_paisa`, never used as a receipt, deduction or income total.
- [ ] **A33** `October!K3:K7` and `K9:K77` classified as shared-formula groups whose master references the previous row, quoting the master text; September/August/July asserted self-row-correct; none imported as a value.
- [ ] **A34** `September!P78` and `October!P78` named as referencing the identical `'August-2026'!Q81`; `August!P77` → `'July-2026'!P50`; `July!O46` → `'March-2026'!M13`; no balance anywhere in the ledger.
- [ ] **A35** `August!O55`/`L60`/`L68` reported as embedded-literal formulas, `August!Q80` as a typed literal; none evaluated or imported.
- [ ] **A36** Per-tab app-recalculated total beside the workbook's stated total and the exact difference, verdict + reason, no tolerance. *(Implemented via `worksheetTotal`; see R9 resolution.)*
- [ ] **A37** `csvHeaders` unchanged; rides CSV byte-identical; existing CSV suite untouched.
- [ ] **A38** Variance CSV emits its own ten-column header, UTF-8 BOM, correct quoting, `'` prefix on `=`/`+`/`-`/`@` values.
- [ ] **A39** `schema_version` 4; `BACKUP_TABLES` 19 names; `docs/BACKUP-FORMAT.md` updated; v3 backup restores into v4 with the new tables empty; v4 round-trips; unknown table/column still rejected.
- [ ] **A40** Injected staging/activation failures with the three new tables present leave the original dataset active and intact.
- [ ] **A41** All five caps and all six unsafe-ZIP conditions rejected before parsing; no-header workbook rejected naming the tab and columns found.
- [ ] **A42** No path, SQL text or driver message in any body; the 500 body is the existing fixed string; the filename never builds a path or appears in an error.
- [ ] **A43** Matching SHA-256 refused with the earlier import's date and row count; proceeds only with `confirmed:true` and a stored reason.
- [ ] **A44** A candidate matching an existing ride on date, time, distance and cash is a non-blocking warning; the commit still succeeds and records the row `imported`.
- [ ] **A45** Keyboard-operable with accessible names for picker, preview table, commit control and variance download; no horizontal overflow at 390 px; imported/missing/unknown distinguished in text.
- [ ] **A46** With external requests aborted, the full path completes with no external request and no page error; `exceljs` in the server bundle only, never in the Vite client output.
- [ ] **A47** Distinct `randomUUID()` per ride, a history event, and an `import_rows` row linking `ride_id` to `sheet_name`/`sheet_row`; `rides.data` valid per `validateInput()`; `timezone` equals the app setting.
- [ ] **A48** A failure on the last ride leaves zero rides, zero `import_rows` and zero `import_variance` for that source.

## Open Questions

None requiring an owner decision. Every item is a technical call made above with its evidence. Three implementation-time verifications against the real file are carried from deliverable §9 and are recorded as assertions in the test suite rather than assumptions:

1. every stored date serial is in the 1900 system (assert and refuse 1904 otherwise);
2. July's 7 text `HH:MM:SS AM/PM` pick times parse cleanly — any that do not must land as `null`, never guessed;
3. October's 5 rows are genuinely all of October's rides — the preview must show the owner which October rows exist so they can confirm.

Also unverified and non-blocking: whether any of the ~176 rides were already entered into the app by hand. R16 warns without blocking; the owner resolves it during review.

## Out of Scope

Explicitly not addressed, per DEL-01 §4 and the owner's answers:

- Expenses, odometer, use allocation, operating profit, driver hours, office/vendor cost comparison — deferred by the owner, not rejected.
- The `Cost Compare-Office with Uber-v` tab contents, the `Q82:Q86` expense blocks and the driver work-log regions as data.
- Fetching the external Google Drive screenshot URLs — read-only text evidence only (localhost-only charter, D1).
- Retaining the workbook file or its bytes; no new file class in `attachments`.
- Any change to `csvHeaders` or the rides CSV contract; bulk-reviewing imported rows; user-editable month mappings; a new rides CSV.
- LAN access, multi-user behaviour, cloud synchronisation — rejected and closed (D1).
- PaddleOCR / Bangla OCR — out of this cycle by default; the `OcrAdapter` seam at `src/ocr.ts:3` already exists for a future attempt.
