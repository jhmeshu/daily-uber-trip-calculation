# Implementation todo list

Source: [PRD](Uber-Ride-Tracker-PRD.md). Read the [analysis](PRD-ANALYSIS.md) and [implementation plan](IMPLEMENTATION-PLAN.md) for assumptions, design, milestone gates and acceptance scenarios A01–A22.

**Current phase: defined MVP complete; M0–M5 verified.** Development authorized on 6 October 2026. Prioritize in milestone order. Mark an item complete only after its behavior and relevant checks are verified.

## M0 — Planning

- [x] M0-01 Read the repository PRD and inspect the existing project state.
- [x] M0-02 Document scope, accounting invariants, risks, proposed decisions and acceptance traceability.
- [x] M0-03 Create the phased implementation plan and actionable checklist.
- [x] M0-04 Record user decisions: this Mac first; representative screenshots available before parser validation.

## M1 — Manual-entry accounting and CSV

Dependency satisfied: user instructed development to start. This milestone is the first implementation priority. M1-01 through M1-10 completed and verified on this Mac. Attachment-specific cleanup was implemented and verified in M2-02.

- [x] **M1-01 Runtime and scaffold:** choose compatible Node/TypeScript/React/SQLite versions and libraries; add lockfile, scripts, runnable local frontend/API and a single normal-use start command. Document prerequisites and initial platform support.
- [x] **M1-02 Shared domain rules:** implement exact integer-paisa input, null/zero handling, financial bases, required date/time, calculation status, both income values, financial confirmation and explained-adjustment validation. Test A04–A08 and invalid inputs.
- [x] **M1-03 Durable persistence:** configure the persistent data directory; add UUID-based schema, transactional migrations, constraints and timestamps for rides, sessions, confirmations, history and settings. Verify restart persistence and failed-migration rollback.
- [x] **M1-04 Local API and queries:** bind to `127.0.0.1`; validate host/origin and all input; implement CRUD and reviewed-only aggregation by local date. Share filter definitions across queries and export. Reject client-supplied authoritative totals.
- [x] **M1-05 Autosave and history:** recover drafts and pending edits after refresh; show persistence errors; save reviewed revisions and timestamped changes atomically without autosaved typing altering current reports.
- [x] **M1-06 Trash lifecycle:** confirm deletion, exclude deleted rides from reports, retain previous state/deletion time, restore with validation and define explicit permanent removal. Add reference-aware file cleanup once attachments exist.
- [x] **M1-07 Manual review form:** support blank versus explicit zero, required financial review, basis confirmation, net-only drafts, live calculations, correction history and save/draft actions. Invalidate prior financial confirmation when its values change.
- [x] **M1-08 Initial ledger:** show all PRD ride columns and review status; filter by range/month/payment/service/status and search locations/comments; display unknown values honestly; support edit/trash navigation.
- [x] **M1-09 CSV contract/export:** document fixed headers including IDs, statuses and relative attachments; implement all-reviewed/current-filter export with explicit draft inclusion, UTF-8 BOM, ISO date/24-hour time, numeric km/BDT, escaping and text formula protection. Explain that CSV is not a complete backup. Test A15.
- [x] **M1-10 Milestone acceptance:** demonstrate manual entry → draft → review → restart → correction → delete/restore → filtered CSV; verify A01/A04–A08/A12–A15 for the implemented scope.

### M1 verification — 6 October 2026

- `npm test`: 11 passing domain/storage/API tests, including failed history/autosave rollback.
- `npm run build`: TypeScript check and production frontend build passed.
- `npm run test:e2e`: 1 passing Chromium workflow covering immediate refresh recovery, draft/review/correction, history, trash/restore, filters and CSV download; 390px layout checked.
- Browser workflow required no external requests. Complete offline/OCR acceptance remains in M5.
- Setup, data location, recovery and CSV contract: [README](../README.md). Scenario evidence: [M1 acceptance record](M1-ACCEPTANCE.md).

## M2 — Intake, original files, and local OCR

Dependency: M1. Take on parser and trip-similarity behavior in M3 after the engine/storage path works.

- [x] **M2-01 Intake validation:** add PNG/JPEG/WebP selection, drag/drop and browser-supported image paste; enforce 20 files/batch and the proposed 10,000,000-byte limit on client and server; provide actionable type/size/count errors and paste fallback.
- [x] **M2-02 Attachment storage:** validate decoded images/dimensions; generate safe filenames; retain originals, source names, hashes, metadata and previews. Stage writes safely, contain paths and maintain reference-aware cleanup. Verify restart and shared-file deletion behavior.
- [x] **M2-03 Exact image duplicates:** check content hashes before OCR; identify existing records/groups and offer reuse/skip/comparison without silently creating, merging or deleting rides.
- [x] **M2-04 Queue, grouping and image preparation:** persist per-file state and explicit trip groups; attach/remove/regroup images; implement rotation and optional crop using working derivatives, preserving originals and source-coordinate transforms.
- [x] **M2-05 OCR assets and adapter:** install locally served Tesseract worker/WASM/English language assets; record compatible engine/assets metadata; expose availability diagnostics and setup instructions. Keep recognition behind a replaceable adapter.
- [x] **M2-06 OCR job execution:** run real recognition in a browser worker with bounded concurrency, per-file progress, retry, cancel and interrupted-job recovery. Prevent late cancelled results from overwriting newer work.
- [x] **M2-07 Review viewer:** add desktop side-by-side/narrow-screen stacked images and form, zoom/image switching and raw text. Persist exact OCR output, source references and relevant confidence/position data. Keep manual entry usable after failure.
- [x] **M2-08 Milestone acceptance:** exercise batch validation, grouping, original preservation, interrupted recovery, offline recognition, failure/cancel/retry and persisted results with actual OCR (A01–A03/A10/A17–A19).

M2 verification: `npm run build` passed; `npm test` 12 passed; `npm run test:e2e` 2 passed. The synthetic-image browser workflow used actual Tesseract OCR with external requests blocked. Originals and shared-file cleanup, decoded-image/batch limits, crop/rotation, cancellation tokens, interrupted recovery and raw positional output were verified. Representative samples supplied at `/Users/janibulhoque/Downloads/uber/` for M3. Deferred backlog explicitly excluded by user.

## M3 — Parsing, provenance, and duplicate resolution

Dependency: M2. Use synthetic fixtures initially; the user expects to provide representative screenshots before M3-05.

- [x] **M3-01 Deterministic parser:** normalize supported digits/currency/whitespace/date/time/distance/duration conservatively; use labels and positions; distinguish receipts, deductions, tips and net earnings. Keep unsupported meanings unresolved. Add clearly labeled synthetic fixtures and no-inference tests.
- [x] **M3-02 Candidate/evidence model:** retain every source observation, exact text, image/position, engine/parser versions and extraction confidence; combine explicitly grouped images into alternatives without silent selection.
- [x] **M3-03 Field review and correction:** show extracted/corrected/manual/missing origins; resolve conflicting candidates explicitly; retain correction history; protect manual edits during reprocessing and re-confirm current financial values before review.
- [x] **M3-04 Trip duplicate decisions:** compare optional trip IDs and date/time/route/distance/amount evidence; show matching records; implement attach-to-existing, skip, or save-separately-with-reason. Block unresolved incoming candidates from reviewed totals without removing existing reviewed rides; recheck on save.
- [x] **M3-05 Real-layout validation:** use the representative screenshots expected before this step; record expected fields, field-level results, supported layouts and failures. If samples are delayed, leave this item pending and continue independent tasks; keep untested parsing visibly experimental and do not claim unmeasured accuracy.
- [x] **M3-06 Milestone acceptance:** verify unsupported layouts, already-net drafts, exact/possible duplicates, legitimate multi-image rides, cross-image conflicts, provenance and correction preservation (A03/A07/A09–A12).

M3 verification: build passed; 15 automated tests and 2 browser workflows passed. Conflict decisions and separate-trip reasons are checked again on save; prior raw OCR and observations survive reprocessing and manual edits are preserved. Real recognition/parser validation completed on both supplied JPEGs: 11/11 asserted outcomes each, including intentional unknowns. [Field-level results and route limitations](REAL-LAYOUT-VALIDATION.md). Parsing remains experimental; no general accuracy is claimed.

## M4 — Dashboard, settings, and complete backup/restore

Dependency: M3 schema/provenance and earlier persistence behavior.

- [x] **M4-01 Dashboard:** calculate reviewed count, measured distance/coverage, cash, credit, commission/pass, tips and both income totals by month; use excluding-tips income as the main labeled KPI; show recent rides, drafts, duplicate candidates and missing route/distance. Test month boundaries and exclusions.
- [x] **M4-02 Settings and filter completion:** expose data location, timezone, OCR availability, calculation explanation and recovery actions; verify ledger/dashboard/export scopes, search, all filters and stored local-date behavior when defaults change.
- [x] **M4-03 Backup creation:** specify the versioned JSON/ZIP manifest and create a consistent snapshot with original attachments, drafts, trash, sessions, settings, evidence and history. Include counts, relationships and hashes needed to validate restoration.
- [x] **M4-04 Restore validation and preview:** stage the archive; reject unsupported schemas, unsafe paths/entries, excessive expansion, corrupt data, invalid references and missing/mismatched files; preview record counts and require replacement confirmation.
- [x] **M4-05 Restore activation and recovery:** coordinate database/files as one recoverable replacement; prevent concurrent mutation during activation; keep existing data until success and recover from interruption. Test fresh-install round-trip and injected failures at staging/activation boundaries (A16/A21).
- [x] **M4-06 Milestone acceptance:** reconcile dashboard outputs against fixture expectations and prove complete backup restoration with matching IDs, provenance, settings and image hashes.

M4 verification: build passed; 16 automated tests and 3 browser workflows passed. Complete ZIP restoration matched every backed-up table and original image hash; foreign references, unsafe paths, missing images, wrong hashes and unsupported schemas were rejected. Injected staging and before-activation/after-pointer/after-open failures preserved the original active dataset. Restart followed the persisted generation pointer. Browser verified dashboard totals, default-timezone preservation and confirmed restoration.

## M5 — Release checks and documentation

Dependency: all implementation milestones. Focused tests in M1–M4 must already pass.

- [x] **M5-01 Offline acceptance:** use the installed build with external networking disabled for screenshot import → real OCR → correction/review → save → dashboard → CSV → full backup/restore. Verify all workers/assets load locally and no required requests leave the machine.
- [x] **M5-02 Persistence and recovery:** validate app/browser restart, interrupted work, migration failures, upgrades retaining the configured data directory and recovery of draft sessions/attachments. Exercise the maximum batch with representative image sizes.
- [x] **M5-03 API and storage acceptance:** test unexpected host/origin mutation rejection, invalid bodies/files, path containment and archive failures; verify exported references never disclose raw filesystem paths.
- [x] **M5-04 Usability acceptance:** walk through all five screens with keyboard controls and narrow layouts; check labels, focus, visible errors, BDT formatting, financial review, queue progress and destructive-action confirmations.
- [x] **M5-05 Delivery documentation:** write setup, prerequisites, asset installation, start/update, data-directory and backup/restore instructions; document CSV schema, financial assumptions, synthetic sample data, limitations and supported operating systems.
- [x] **M5-06 Final acceptance record:** run applicable A01–A22 checks, record commands/results and real-layout coverage, resolve failures and deliver runnable source, lockfile, migrations and test suite. Leave unmeasured parsing accuracy explicitly unclaimed.

M5 verification: final build passed; 18 automated tests and 4 browser workflows passed. The production-build workflow blocked external browser requests, ran actual local OCR, reviewed/saved, checked dashboard and CSV, backed up/restored and restarted the app. Maximum 20 distinct synthetic images with representative dimensions/byte counts, API/archive failures, visible autosave failure/recovery, keyboard navigation and narrow layouts were exercised. Earlier real-screenshot validation passed; later Downloads rereads were denied by macOS (`EPERM`), recorded without claiming an additional real-batch pass. [Final A01–A22 evidence and limits](FINAL-ACCEPTANCE.md), [setup/recovery](../README.md), [backup contract](BACKUP-FORMAT.md).

Delivery: replaced the previously running M1 server with the completed schema-3 app at `http://127.0.0.1:4310`. Took a stopped-server safety copy before migration; startup/health/OCR availability and existing-record equality were verified. No synthetic data was added to the normal user dataset.

## Screenshot-reading repair — 6 October 2026

- [x] Diagnose the uploaded screenshot: original saved successfully, but opening Review did not start OCR.
- [x] Start OCR from Review, display progress/cancel/retry, and fill unambiguous blank fields while preserving corrections and explicit financial review.
- [x] Surface OCR initialization failures and bound recognition time so jobs do not leave the interface stuck.
- [x] Verify production build, existing workflows, retry/correction regression and the actual uploaded JPEG; deliver the updated local app.

Repair verification: build and all 18 automated tests passed. Eight browser workflows passed, including direct review OCR, cancellation/retry, initialization failure recovery, corrections and intentionally cleared fields surviving session recovery, grouped-image conflicts, the actual uploaded JPEG, and existing offline/backup workflows. The app was restarted at `http://127.0.0.1:4310`; rides, unfinished sessions and screenshot records matched the pre-restart snapshot. A complete safety backup was saved before restart.

## Screenshot field corrections — 6 October 2026

- [x] Map recognized Cash collected to Payment method Cash.
- [x] Remove the leading question-mark pickup marker; preserve original OCR evidence.
- [x] Edit and display duration in hh:mm:ss, including recovered unfinished sessions.
- [x] Derive net earnings as cash collected minus known tips; update after corrections and leave missing/conflicting inputs unresolved.
- [x] Validate both real screenshots, regression tests and the installed local app.

Field-correction verification: build passed; 21 automated tests and nine browser workflows passed, including both supplied JPEGs. The tipped screenshot yielded Cash, 00:39:10, cash BDT 407.38, tips BDT 40.00 and net earnings BDT 367.38; correction to cash BDT 500.00 updated net to BDT 460.00. Duration 01:02:03 saved 3723 seconds and displayed the same format. Old pickup-icon evidence stays in history without causing a current conflict. Local app restarted after a safety backup; rides and screenshots stayed unchanged, the unfinished session was retained, and concurrent autosave advanced its revision while setting payment method to Cash.

## Deferred backlog — outside MVP

User explicitly selected “Complete the defined MVP first” on 6 October 2026. These items remain outside this delivery; they are not unfinished MVP tasks and require a later scope change.

- [ ] Historical XLSX import with month-specific mappings, row preview, formula recalculation and balance reconciliation.
- [ ] Fuel/repair/periodic-pass expenses, odometer/use allocation and operating-profit reports.
- [ ] Driver hours and office/vendor cost comparisons.
- [ ] PaddleOCR adapter implementation, Bangla OCR tuning and further screenshot layouts.
- [ ] XLSX export, LAN access, multi-user behavior or cloud synchronization.
