# A23 · feature · Historical workbook import with in-app recalculation and variance reporting

> **Source:** `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/deliverables/DEL-01-historical-workbook-import.md` (DEL-01, pm-cycle-2026-10-08-00-52-03)
> **Type:** feature

## Problem

The owner's only historical record of their rides is a multi-tab spreadsheet holding roughly 176 rides across March, July, August, September and October 2026. Some of that workbook's computed cells are wrong — the `Fare(-tip)` column on the October tab is wrong for 76 cells because two shared-formula masters point one row above themselves, September and October both open on the identical carried-in balance `='August-2026'!Q81`, and July opens on March's total with April to June absent entirely. Importing those figures as-is would copy known-wrong numbers into the ledger, count the same carried-in balance twice, and make them indistinguishable from correct entries afterwards.

The import must therefore read only the numbers the owner typed, recalculate every total in the app using the app's own domain rules, and report a per-cell variance against what the workbook claims — so the defects become visible instead of copied in. Every imported ride lands as an unconfirmed draft requiring the owner's own financial review.

## Acceptance criteria

- **A23** — Uploading the owner's real `Uber Calculation 2026.xlsx` to `POST /api/import/workbook/preview` returns six tabs with `October-2026`, `September-2026`, `August-2026`, `July-2026`, `March-2026` detected as ride ledgers and `Cost Compare-Office with Uber-v` detected as not a ride ledger; the preview writes **no** row to `rides` and changes no month total.
- **A24** — `October`, `September` and `August` are classified Layout A; `July` Layout B; `March` Layout C with its header correctly located at **row 2**. March's absent `cash`, `uber_credit` and `tips` and July's absent `uber_credit` are reported as absent columns, not as zeros.
- **A25** — Real-ride detection yields exactly **2 / 38 / 68 / 63 / 5** rides for March / July / August / September / October (total 176), and **zero** driver-work-log, close-out or allocation rows appear as rides — the 13 `C`-filled non-ride rows inside July rows 51–77 and all blocks past row 77 on every tab are excluded.
- **A26** — Excel date, time and duration serials convert to correct local `YYYY-MM-DD`, `HH:mm:ss` and whole-second values. A fixture on the last day of a month stays on that date; no imported trip shifts into the following month. Conversion does not use a UTC-applying `Date` path.
- **A27** — Distance text `12.68km` yields 12680 metres. Every `-`, `A/A`, blank and unparseable distance yields `null` and **never** `0`; the same holds for cash, credit, tips, commission and duration.
- **A28** — After committing the whole workbook, all 176 new rides have `status: 'draft'`, `financial_confirmed: false`, `financial_basis: 'unresolved'`, `revision: 1` and `reviewed_at: null`; `/api/dashboard` and `/api/rides` summary values are **identical** before and after.
- **A29** — `POST /api/import/workbook/commit` without `confirmed: true` is rejected with a validation error; with `confirmed: true` it returns the created ride count. The server recomputes every amount from the mapped primitives and ignores any total present in the request body.
- **A30** — Every committed July ride reports `uber_credit_paisa` as a missing field, and every committed March ride reports `cash_collected`, `uber_credit` and `tips` as missing. Opening such a ride in Review shows exactly those fields empty, and `reviewErrors()` blocks review until they are filled.
- **A31** — Every imported ride has `pass_charge_paisa: null`. Rows whose combined "Uber Comission / Pass" cell is non-zero appear in the variance report flagged *"commission/pass combined — pass share unknown"*. No row's combined figure is split by inference.
- **A32** — The workbook's net column is stored in `reported_net_paisa` and is never used as a receipt, a deduction or an income total; no ride's `calculate()` output is derived from it.
- **A33** — The variance report contains rows classifying `October!K3:K7` and `October!K9:K77` as shared-formula groups whose master formula references the previous row, quoting the master formula text. The same report asserts that September's, August's and July's masters are self-row-correct. **None** of these cells is imported as a value.
- **A34** — The report names `September!P78` and `October!P78` as referencing the identical cell `'August-2026'!Q81`, `August!P77` as referencing `'July-2026'!P50`, and `July!O46` as referencing `'March-2026'!M13`. No opening balance, closing balance or carried-forward value appears anywhere in the ledger, and no ride's `trip_date` is altered by a balance.
- **A35** — `August!O55`, `August!L60` and `August!L68` are reported as formulas containing embedded numeric literals, and `August!Q80` as a typed literal where sibling tabs hold a formula. None is evaluated, recalculated or imported.
- **A36** — For each ledger tab the report shows the app-recalculated `income_excluding_tips` total in integer paisa beside the workbook's stated total and the exact difference, with verdict `match`, `variance` or `not_comparable` plus a reason. Comparison uses no tolerance: a one-paisa difference is reported as `variance`.
- **A37** — **Regression on A15.** `csvHeaders` in `src/shared/csv.ts` is unchanged, the exported rides CSV header line and row order are byte-identical to the current build, and the existing CSV test suite passes untouched.
- **A38** — `GET /api/import/workbook/variance.csv` emits its own ten-column header exactly as specified in the deliverable, UTF-8 with BOM, correct quoting, and a leading `'` on any value beginning with `=`, `+`, `-` or `@`.
- **A39** — `schema_version` is 4. `BACKUP_TABLES` in `server/backup.ts:11` includes `import_sources`, `import_rows` and `import_variance`; `docs/BACKUP-FORMAT.md` documents schema version 4 and the three tables. A **v3 backup restores into the v4 schema with the three new tables empty** and all 16 original tables intact, per the owner's batch-2 answer. A v4 backup round-trips with the import records intact. An unknown table or an unknown column in a backup is still rejected.
- **A40** — **Regression on A21.** Injected staging and activation failures during a restore that now involves the three new tables still leave the original dataset active and intact.
- **A41** — A workbook exceeding 25 MB compressed, 512 MB expanded, 10 000 entries, 200 worksheets or 200 000 non-empty cells is rejected **before** any body is buffered or parsed. A ZIP with an absolute path, a `..` segment, a symlink entry, a directory entry, encryption or ZIP64 is rejected. A workbook with no recognisable ride-ledger header row is rejected with a message naming the tab and the columns found.
- **A42** — No response body contains a filesystem path, SQL text or a driver message. The 500 body is the existing fixed string. The uploaded filename is never used to construct a path and never appears in an error message.
- **A43** — Re-uploading a workbook whose SHA-256 matches an existing import is refused with the earlier import's date and row count reported; the import proceeds only with `confirmed: true` and a stored reason.
- **A44** — When a candidate row matches an existing ledger ride on trip date, pickup time, distance and cash, the preview lists it as a non-blocking warning; the commit still succeeds and records the row as `imported`.
- **A45** — The Import-screen section is fully operable by keyboard with accessible names for the file picker, preview table, commit control and variance download; at 390 px there is no horizontal overflow; the preview distinguishes an imported field, a missing field and an unknown verdict in text.
- **A46** — With external browser requests forcibly aborted, the full path — upload → preview → commit → review a draft → save reviewed → dashboard → rides CSV → backup → restore — completes with no external request and no page error; `exceljs` appears in the server bundle only and never in the Vite client output.
- **A47** — Each committed ride has a distinct `randomUUID()` id, a `history` event, and an `import_rows` row linking `ride_id` to its `sheet_name`/`sheet_row`; `rides.data` remains a valid `RideInput` accepted by `validateInput()`, and its `timezone` equals the configured app setting.
- **A48** — A failure injected on the last ride of a batch leaves **zero** rides in `rides` and zero rows in `import_rows` and `import_variance` for that source — the batch is all-or-nothing (invariant 11).

## Constraints

**Domain invariants** (`.agents/rules/backend-development-rules.md`, non-negotiable):

- Blank is not zero. A missing amount is `null`; every unparseable or placeholder cell yields `null` and never `0`.
- Money is integer paisa accumulated with `BigInt`. Decimals exist only at display and CSV boundaries.
- Reviewed-only income. Imported rows are drafts and contribute nothing to `summarize()` or `/api/dashboard`.
- The server is authoritative. The browser previews; the server re-validates and recomputes. Never accept a client-supplied total, status, id or timestamp.
- The parser never invents. An unrecognised layout yields nothing, is never guessed at, and a workbook's computed cells are read as text and never evaluated.
- Local dates, no carry-forward. No opening, closing or carried-forward balance enters the ledger, and no ride's date is altered by one.
- Exact inputs and optimistic concurrency: `exact()` on every mutation body, `requireId()` on every path id, `revision` on every `PUT`, `confirmed: true` on every destructive route.
- A migration is two edits: the new `.sql` file and its filename appended to the array in `server/store.ts`. Never edit a released migration. Update `BACKUP_TABLES` and `docs/BACKUP-FORMAT.md`.
- Multi-step writes are transactional; a partially written import is data loss.
- Storage lifecycle is unchanged — no new file class enters `attachments`, and the uploaded bytes are read, parsed and discarded rather than retained.

**Stack:** Node 24 only (`engines: >=24.14.0 <25`, `.nvmrc` pins the patch; `node:sqlite` required). Bare `node:http`, no framework. `node:sqlite` `DatabaseSync`, synchronous, migrations gated by `PRAGMA user_version`. React 19.3 + Vite 8, no router, no state library, no component library, no CSS framework. Loopback bind `127.0.0.1`, default port `4310`. Shared logic lives in `src/shared/` and must stay dependency-free with no `node:*` imports, since both server and browser import it.

**Dependency:** exactly one new server-only dependency is permitted (`exceljs`, decided and locked). It must never reach the Vite client bundle. The CSP at `server/app.ts:29` and the client output are otherwise unchanged. Update the lockfile and review `npm audit`.

**Security:** never weaken the loopback guards (exact `Host` match, `Origin` validation, `Sec-Fetch-Site`, CSP, `nosniff`, `no-store`, static-path containment). Enforce body and archive limits **before** buffering. Inspect the workbook container's central directory and expanded sizes **before** parsing, and reject unsafe ZIP entries. Never interpolate a path, SQL text, a sheet-derived value or a driver message into a response; the 500 body stays a fixed string. No external network at runtime — the workbook's screenshot URLs are external Google Drive links and are recorded as read-only text evidence only, never fetched.

**Accessibility is load-bearing:** `tests/*.spec.ts` selects exclusively by role and accessible name, so every control needs a real accessible name.

**Out of scope** (deferred by the owner, not rejected): expenses, odometer, use allocation, operating profit, driver hours, office/vendor cost comparison. Also out of scope: a new rides CSV or new rides-CSV columns, bulk-reviewing imported rows, user-editable month mappings, multi-user, LAN, cloud anything.

## Dependencies

- **`exceljs`** added to `dependencies`, server-side only.
- Existing and reused unchanged: `fflate`, `node:sqlite` `Store.transaction()`, `validateInput()`, `calculate()`, `reviewErrors()`, `parseDecimal()`, `cleanLocation()`, `summarize()`, `exact()`, `requireId()`, `randomUUID()`, sha256 from `node:crypto`, the binary body-limiting helper in `server/intake-routes.ts`, and the comparison rules in `server/evidence.ts`.
- **A15** and **A21** are existing acceptance criteria in `docs/FINAL-ACCEPTANCE.md` that must not regress.
- None. This is the only deliverable in cycle `pm-cycle-2026-10-08-00-52-03`.

## Notes for planning

Read the deliverable itself before planning — it carries the verified workbook layout (three column layouts, per-tab ride-row ranges, cell representations, 93 formula cells, the merged balance ranges) and the full requirements R1–R18, which this ticket deliberately does not restate. Prior art to reuse rather than reinvent: `src/shared/domain.ts` (`parseDecimal`, `calculate`, `reviewErrors`, `cleanLocation`), the `/api/restore/preview` → `/api/restore/activate` staged pattern this mirrors, `archiveEntries()` in `server/backup.ts` for the inspect-before-parse ordering, and the `duplicate_decisions` model for the SHA-256 re-import guard. Highest risk: `exceljs` may expand shared formulas into per-cell formulas, which would make October's 69 broken cells look self-row-correct and hide the defect — the raw `si`/`ref`/master grouping must be read, via `exceljs` metadata or `fflate` + `sheetN.xml`, or A33 cannot pass. Test fixture must be the `.xlsx`, not the CSV export: Google Sheets re-renders date and duration serials differently, so the CSV cannot validate the parser. The real workbook lives in gitignored `.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/` and must never be committed; if a fixture is committed it must be a sanitised structural clone with no amounts, names, plates, routes or URLs.
