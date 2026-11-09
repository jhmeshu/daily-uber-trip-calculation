---
trigger: model_decision
description: Server development rules for the Node 24 http/sqlite backend, shared domain logic, validation, and migrations.
---

# Server Development Rules

## Architecture & Code Organization

- **`server/index.ts`** — process entry point. Reads env (`UBER_DATA_DIR`, `PORT`), validates them, builds the store and app, installs the `SIGINT`/`SIGTERM` shutdown handler, and sets `process.exitCode`. No request handling.
- **`server/app.ts`** — `createApp(store, dist)` returns an `http.Server`. Owns the entire HTTP boundary: headers, host/origin guards, static file serving, JSON and binary responses, and the error-status mapping.
- **`server/intake-routes.ts`** — `intakeRoutes(...): Promise<boolean>`. Returns `true` when it handled the request. Delegate by shape, never by re-implementing route parsing.
- **`server/store.ts`** — `Store` wraps `node:sqlite` `DatabaseSync`. Persistence only: no HTTP, no image work.
- **`server/intake.ts`** — `Intake` owns attachments, import groups, batch slots, OCR job lifecycle, and reference-aware cleanup.
- **`server/evidence.ts`** — `Evidence` owns observations, field decisions, duplicate decisions, and review events. It is wired in through `store.reviewGuard` and `store.afterSave`.
- **`server/backup.ts`** — `Backups` owns snapshot, staging, restore preview, and restore activate. `BACKUP_TABLES` is the normative table list.
- **`src/shared/`** — pure, dependency-free logic imported by **both** server and browser (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`). Nothing in `src/shared/` may import from `server/` or from `node:*`.

## Sacred Domain Invariants

### 1. Blank is not zero
- A missing amount is `null` and means **unknown**. It is never `0`.
- `cashNet(r)` returns `null` when either operand is `null` — it does not treat unknown as zero.
- Never infer a missing credit, commission, or pass charge as zero. Never infer a trip year from unrelated map text.
- `money(null)` renders `Unknown`, not `BDT 0.00`.

### 2. Integer paisa, `BigInt` intermediates
- Persist money as integer paisa in `*_paisa` fields. `parseDecimal(raw, places)` scales exactly with `BigInt` and bounds the result by `Number.MAX_SAFE_INTEGER`.
- Decimals exist only at the display and CSV boundary, via `decimal(value, places = 2)`.
- Sum money with `BigInt` accumulation. Floating-point accumulation of paisa is a bug.

### 3. Income is reviewed-only
- Only rides with `status === 'reviewed'` **and** `reviewErrors(r).length === 0` contribute to income.
- `summarize(rides)` implements this. Drafts, trash, and pending duplicates contribute nothing.
- `matches(r, f)` is the single filter contract shared by ledger, dashboard, and CSV export. Do not re-implement filtering per screen.

### 4. The server is authoritative
- The browser computes previews with the same shared functions, but the server always re-validates via `validateInput(raw)` before persisting.
- Never accept a client-supplied derived total as truth. Recompute with `calculate(r)` on the server.

### 5. A financial edit invalidates confirmation
- Any change to a field in `financialFields` must reset `financial_confirmed`.
- `financialSignature(r)` is the canonical invalidation signal. Compare signatures, not field-by-field guesses.

### 6. Income formula
```
income_including_tips = cash_collected + uber_credit - commission - pass_charge
income_excluding_tips = income_including_tips - tips
```
- `tips_paisa` may be subtracted from `cash_collected_paisa` to derive the cash net — but only when both are known.
- Monthly subscriptions are **not** a per-ride deduction.
- `calculate(r)` returns `{ status: 'unresolved' | 'incomplete' | 'complete', including, excluding, warnings }`. Do not collapse those states.

### 7. The parser never invents
- `parseOcr` returns `Observation[]`. An unrecognized layout returns **zero** observations, never a guess.
- Never silently choose between conflicting observations for one field — surface them for review.
- `PARSER_VERSION` is persisted with every observation and must be bumped on any parser behaviour change.
- Locations pass through `cleanLocation()` to strip pin/dot/icon OCR artifacts while preserving digits, `#`, `/`, and Bangla.

### 8. Dates are local, with no carry-forward
- A ride's date is the local calendar date it belongs to. Never roll a date forward to "complete" an unfinished month, and never infer a date from another field.
- Validate with `validDate(value)` / `parseDuration(raw)` rather than `new Date(...)` string slicing.

### 9. Input validation & error envelopes
- Every mutation body is checked against its exact key set with the `exact(obj, keys)` helper. An unknown **or** a missing key is a `ValidationError`.
- Every path id goes through `requireId(id)`.
- Error mapping happens at the boundary, and nowhere else: `ValidationError` → 400, `ConflictError` (revision) → 409, `ENOENT` → 404, anything else → 500 plus a fixed safe message.
- The 500 message is deliberately fixed. Never interpolate a filesystem path, SQL text, or a driver message into a response.
- Optimistic concurrency is mandatory: `PUT` bodies carry `revision`; a mismatch is a `ConflictError`.
- Destructive operations (`trash`, `restore`, `purge`, `restore/activate`) require `{ revision, confirmed: true }`. `confirmed !== true` is a 400.

### 10. Migrations
- A schema change is **two** edits: add `server/migrations/0NN-<name>.sql` **and** append its filename to the array in `server/store.ts`.
- Migrations are `.sql` files read through `import.meta.url`, wrapped in `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, and gated by `PRAGMA user_version`.
- Never edit an already-released migration. Never use a version number lower than the highest shipped file.
- `migrate()` refuses to open a database whose `user_version` is newer than the app. That refusal is intentional.
- If a change adds or renames a table, update `BACKUP_TABLES` and re-check `docs/BACKUP-FORMAT.md`; a schema change that silently drops a table from backups is a data-loss defect.
- `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL` are set at open. Do not weaken them.

### 11. Multi-step writes
- Any write that touches more than one table runs inside `store.transaction(() => ...)`. It is re-entrant, so nesting is safe.
- Partial writes are data loss, not a cosmetic bug.

### 12. Storage layout & lifecycle
- Data root: `~/Library/Application Support/Uber Ride Tracker`, overridable with `UBER_DATA_DIR`.
- `current.json` points at `generations/<uuid>`. Pointer flips are atomic (tmp → `fsync` file → `fsync` parent dir → `rename`).
- Generated storage keys are `${uuid}.${ext}` only. Write with `flag: 'wx'`, `mode: 0o600`, into directories at `mode: 0o700`, via `.tmp` + `renameSync`.
- `Intake.cleanup()` deletes originals no longer referenced by any `import_items`. Batch slots are upload receipts, not owners.
- On startup, OCR jobs left `running` are flipped to `interrupted` and their tokens nulled.
- **Never** delete or modify a live `rides.sqlite` or its `-wal` / `-shm` sidecars while the app is running.