# Implementation plan

Source: [PRD v1.0](Uber-Ride-Tracker-PRD.md). Companion documents: [analysis and proposed decisions](PRD-ANALYSIS.md), [working todo list](TODO.md).

**Defined MVP completed on 6 October 2026 at the user's instruction, with sequential milestone verification.** See [TODO.md](TODO.md) and [final acceptance](FINAL-ACCEPTANCE.md). This document retains the original implementation approach and gates; the deferred backlog was explicitly excluded by the user.

## 1. Delivery approach

Follow the PRD's build order: reliable manual accounting first, then screenshot intake and real local OCR, then deterministic parsing and duplicate resolution, then dashboard/backup/offline acceptance. Keep the app runnable at each completed implementation milestone. Develop meaningful tests with the behavior they protect, not as an isolated final phase.

The user confirmed this Mac as the first supported environment and representative screenshots before parser validation. Use React and TypeScript for the browser, a Node.js/TypeScript localhost server, SQLite, a persistent local attachment directory, and Tesseract.js in a browser worker, as suggested by the PRD. Choose exact supported runtime and dependency versions during development; this plan makes no current-version or compatibility claims.

No calendar estimate is committed before runtime compatibility and screenshot layout variety are understood. The milestones below define outcomes and dependencies rather than speculative dates.

## 2. Proposed architecture

```text
Browser: React review, intake, ledger, dashboard, settings
  |-- local OCR worker -> adapter -> exact text + positional evidence
  |-- deterministic parser -> field candidates, never final financial truth
  |-- shared validation/calculation functions -> live previews
  |
  +-- same-origin localhost API on 127.0.0.1
        |-- server validation + authoritative calculations + aggregate queries
        |-- SQLite: rides, sessions, evidence, history, settings, import state
        |-- persistent files: originals, previews, working derivatives
        +-- CSV export and versioned ZIP backup/restore

The same server serves the built frontend and local OCR assets.
```

Separate responsibilities:

- **Domain:** money parsing, calculation eligibility/status, date validation, financial confirmation, duplicate candidate rules, export row mapping. Share rules across UI and server; the server remains authoritative.
- **Persistence/API:** transactional mutations, schema migrations, attachment ownership, history, trash, filters and aggregate queries. Reject malformed requests and unexpected host/origin values.
- **OCR:** asset availability, engine version, recognition, progress, cancellation, and raw results behind an adapter. Keep engine output distinct from parser output so a future local engine can replace Tesseract without changing accounting.
- **Parser/provenance:** conservative normalization, labels and positions, candidate alternatives, evidence references, user corrections and manual overrides. Retain exact source text independently of normalized values.
- **UI:** the five PRD screens with keyboard-accessible controls, BDT labels, clear missing values, progress, and recovery actions.
- **Export/recovery:** one filter contract for ledger and CSV; consistent backup snapshots; validated, staged replacement during restore.

Avoid unnecessary infrastructure: no cloud backend, accounts, remote inference, telemetry, background daemon, or separate database service is required.

## 3. Persistence and lifecycle design

Use stable UUIDs, foreign keys, explicit schema versions, and transactional migrations. Keep the persistent data directory outside source/build output and document its default and override. Installation assets and user data have separate lifecycles.

| Entity | Planned responsibility |
| --- | --- |
| Ride | PRD fields, optional screenshot trip ID, status, prior status/deletion metadata, timestamps and confirmed financial interpretation |
| Attachment + ride link | Content hash, source filename, generated storage key, image metadata; links allow multiple views and safe reuse without equating a file with a ride |
| OCR run | Attachment/working-image reference, transforms, engine and language metadata, status, exact text, confidence/positional output |
| Extraction/evidence | Field candidates, source image/text/position, parser version, selected/rejected alternatives, extracted/corrected/manual/missing origin |
| Review session/import queue | Autosaved unsaved edits, image grouping, interrupted jobs and retry state; can recover without overwriting a reviewed ride |
| Change event | Timestamped before/after field changes, confirmations and duplicate decisions; one local user needs no account model |
| Settings | Timezone, persisted application preferences and compatible backup metadata |

Do not store derived income as an independently editable authoritative value. Proposed calculation statuses are `complete`, `incomplete`, and `unresolved`; document their precise conditions in M1. Review status is separate: even a calculable draft is excluded from finalized totals.

Lifecycle rules:

1. Create/manual import starts as a draft with nullable unknown values. Autosave is durable and shows failures; it never reports success before persistence succeeds.
2. OCR produces candidates without finalizing a ride. Re-running OCR must not overwrite manual corrections silently.
3. Review requires valid date/time, confirmed worksheet basis, known financial values, any adjustment explanation, and resolved conflicts/duplicate decisions. Route/distance can remain missing with visible coverage indicators.
4. Saving changes to a reviewed ride writes values, confirmation and history together. Financial edits require renewed confirmation; unfinished edits stay in the recoverable session until saved.
5. Deletion moves the ride into trash and removes it from reports. Restoration revalidates the previous state. Permanent removal cleans only unreferenced files and preserves required audit consistency.
6. Changing the default timezone applies to new records; do not silently reinterpret stored local trip dates or rewrite historical months.

## 4. Milestones and completion gates

### M0 — Planning and decisions (completed)

Deliver this analysis, implementation plan, and dependency-ordered checklist. Record the confirmed Mac-first target, expected screenshot samples and proposed interpretations. Preserve the source PRD unchanged. No application development took place during M0.

Gate: planning documents are internally consistent and usable; confirmed preferences and proposed implementation decisions are distinct. The later development instruction was received on 6 October 2026.

### M1 — Persistent manual-entry accounting and CSV

Depends on: user instruction to begin development (received). Initial platform: this Mac. M1 is now complete; see the linked checklist and acceptance record.

- Establish the runtime, project structure, same-origin local server, scripts, compatible dependencies/lockfile, and a persistent data directory.
- Implement domain rules before tying them to the interface: exact money parsing, null versus zero, financial bases, confirmation, unusual adjustments and calculation status.
- Add transactional migrations, validated CRUD, timestamped history, autosaved sessions, draft/review transitions, trash/restore/purge, and date-based filtering.
- Build manual ride entry, an editable ledger, and shared filter/search behavior.
- Implement stable CSV headers and documented formatting, current-selection/all-reviewed export, explicit draft inclusion, and formula-injection handling for text.

Gate: a ride can be entered, saved, restarted, corrected, reviewed, deleted/restored, filtered and exported without OCR. A05/A06 calculate exactly. Incomplete/already-net-only records cannot enter final totals. Export preserves blank/zero distinctions and never exposes absolute paths.

### M2 — Screenshot intake, storage, and working local OCR

Depends on: M1 persistence and draft workflow.

- Implement batch selection, drag/drop and supported-browser paste; enforce file count/type/size limits in UI and server.
- Persist originals, hashes, previews, transforms and queue/grouping state. Validate actual image content/dimensions and generated storage paths.
- Support explicit grouping, attachment removal/reassignment, rotation and optional crop with originals intact.
- Check hashes before OCR, show exact-file matches and avoid redundant processing; fuller trip-comparison resolution follows in M3.
- Serve pinned compatible worker/WASM/language assets locally; expose asset availability and installation instructions.
- Run real Tesseract through an adapter with bounded concurrency, per-file progress, retry, cancel and recovery from interruption.
- Build the side-by-side review viewer, narrow-screen stack, zoom/image switching, raw-text display and manual review fallback.

Gate: real OCR runs on local assets without internet and returns persisted raw text/evidence. Refresh/restart recovers drafts and attachments. Cancel/failure affects the appropriate job and cannot erase reviewed data. Grouping never assumes an entire batch is one trip.

### M3 — Deterministic extraction, provenance, and duplicate review

Depends on: M2 image/OCR output and M1 review gates.

- Create synthetic fixtures explicitly marked synthetic and define conservative parsing for labels, positions, English/Bangla digits, BDT, dates/times, distances and durations.
- Keep cash, credit, fees, tips and already-net labels semantically distinct; leave uncertain or unsupported values missing.
- Merge image observations into candidate sets, expose contradictions, retain source evidence and respect existing manual corrections.
- Add field-origin indicators and financial confirmation tied to the current values; all financial fields receive review emphasis.
- Implement possible-trip duplicates using trip ID when available plus date/time/route/distance/amount evidence. Present comparison with attach, skip, or save separately with a reason. Recheck at save so stale review state does not bypass resolution. Keep incoming candidates draft without changing existing reviewed totals.
- Validate the representative real screenshots the user expects to supply before this step; report results per field/layout and document failures. Keep untested layouts explicitly experimental. If samples are delayed, leave the validation task open and continue independent work.

Gate: A03/A07/A09–A11 pass; real-screenshot validation results and remaining layout limitations are recorded; neither a conflict nor a pending duplicate becomes a reviewed ride silently. OCR is real even if parser quality is still provisional.

### M4 — Dashboard, backup/restore, and settings

Depends on: stable M1–M3 data relationships and history.

- Complete dashboard totals, month selection, recent rides, draft/duplicate counts and missing-route/distance indicators. Make the main KPI income excluding tips; show income including tips separately and explain that neither is operating profit.
- Complete ledger filters and settings for data location, timezone, OCR availability, calculation explanation and backup/restore.
- Define a backup format version independently from database migrations. Export a consistent data snapshot and originals, including drafts, trash, evidence, history, sessions and settings.
- Restore in a staging area: constrain archive paths and unpacked size, validate supported schema, IDs, relationships, hashes and required files; preview counts; require confirmation before replacing data.
- Prevent concurrent mutations while creating the final snapshot/activating a restore. Use a recoverable activation protocol that switches database and attachments together and retains the existing generation until success. Account for SQLite open handles/journal state and interrupted activation at next startup.

Gate: a backup restores into a fresh installation with matching records and image hashes. Invalid, corrupt, interrupted or failed restoration preserves the original active dataset. Month totals match independent expected values and exclude drafts/deleted rides.

### M5 — Release validation and documentation

Depends on: all earlier gates. This is integration acceptance; focused domain/storage tests run in the milestone that adds the behavior.

- Run the installed build with external network access disabled through import → real OCR → review → save → restart → dashboard → CSV → backup/restore.
- Check maximum-size batches, interruption handling, migration/persistence behavior, local API/file boundaries and keyboard/narrow-screen usability.
- Finish setup/start/update/recovery documentation, local asset instructions, synthetic sample data, CSV schema, data location, financial assumptions and extraction limitations.
- Run all acceptance scenarios and record their evidence, remaining limitations and actual real-screenshot validation status.

Gate: runnable source, lockfile, migrations, local OCR setup and meaningful tests are delivered; the offline core workflow passes. Real-layout accuracy remains unclaimed until measured on actual samples.

## 5. Test strategy

| Layer | Essential cases |
| --- | --- |
| Domain unit tests | Integer money/decimal handling; null and zero; required financial confirmation; worksheet formula; already-net drafts; tips classification; explained adjustments; local-date month boundaries |
| Parser fixtures | Synthetic text/positions; labels; uncertain formats; digits; explicit net amounts; conflicts across images; evidence retention; no invented fees |
| Persistence/API integration | Restart, migrations, revision/history atomicity, autosave failure, trash/restore, duplicate decisions, shared attachment lifecycle, rejected host/origin/input |
| Export/backup integration | CSV escaping/BOM/formula text/numeric signs; filter consistency; complete archive round-trip; invalid paths/schemas/references; file hash mismatch; failure injection during restore |
| Browser/workflow tests | Manual entry through export; group/review/correct screenshots; actual OCR on a known synthetic image; progress/cancel/retry; refresh recovery; offline asset requests |
| Manual acceptance | Supplied real screenshots; clear financial language; screen reader labels/keyboard controls; narrow-screen layout; setup on the user's Mac |

Synthetic OCR fixtures prove the engine integration and deterministic rule behavior. They are not a substitute for reporting actual screenshot extraction accuracy. A controlled adapter may exercise failure/cancellation tests, but the acceptance workflow must use real OCR.

## 6. Definition of done

MVP completion requires every mandatory item in [TODO.md](TODO.md), all applicable acceptance scenarios in the [analysis](PRD-ANALYSIS.md), and the deliverables listed in PRD section 12. With samples expected before parser validation, include their field-level results in acceptance. If availability changes, follow the PRD's experimental-parser fallback and explicitly record the incomplete validation instead of claiming tested accuracy; OCR/manual review must still work.

Do not include historical spreadsheet import, reconciled balances, expenses/profit, driver logs, PaddleOCR, LAN access or multi-user behavior in this implementation unless a later user request changes scope.
