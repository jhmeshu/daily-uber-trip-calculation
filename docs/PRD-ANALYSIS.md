# PRD analysis

Planning date: 6 October 2026. Source: [Uber Ride Tracker PRD v1.0](Uber-Ride-Tracker-PRD.md).

**Status: original planning analysis retained; M1–M5 implementation completed on 6 October 2026 after user authorization.** Proposed decisions below clarify implementation; they do not amend the source PRD. See [TODO](TODO.md) for live progress.

## 1. Assessment

The PRD is sufficiently detailed to plan an MVP. Its strongest requirements are the distinction between unknown and zero, explicit financial review, local persistence, and offline operation. The app must be useful through manual entry even when OCR or field parsing fails.

At the time of planning, the repository contained only a minimal README and the PRD. There was no application, dependency manifest, test suite, or existing architecture to preserve. The workbook snapshot mentioned by the PRD and representative screenshots are not present in this repository. Workbook observations are therefore treated as source requirements, not independently verified findings.

The primary engineering risks are incorrect financial interpretation, loss of review edits or attachments, silent conflict resolution, and partially applied restores. Layout-specific parsing is the main unknown in delivery effort. Synthetic fixtures can verify parser behavior, but cannot establish accuracy on actual Uber screenshots.

## 2. MVP boundary

| Included | Deferred by the PRD |
| --- | --- |
| Single-user localhost application; persistent ride records, drafts, history, and trash | Multiple users, LAN access, cloud sync |
| Manual entry; screenshot intake, grouping, local Tesseract OCR, experimental deterministic parsing | PaddleOCR implementation, Bangla OCR tuning, additional layout tuning |
| Financial confirmation; worksheet calculations; reviewed-only reporting | Expense/profit ledger, opening balances, carry-forward accounting |
| Dashboard, searchable/filterable ledger, CSV, complete ZIP backup and restore | Historical XLSX migration, XLSX export |
| Local OCR assets, offline workflow, installation and recovery documentation | Driver work logs and vehicle-cost comparisons |

Normalizing Bangla digits found in text is part of the MVP. Recognizing Bangla screenshots accurately is a later capability. Rotation and user-optional cropping belong to intake; the original image must always be retained.

## 3. Rules that must hold throughout the app

1. Missing amounts remain `null`. A blank, failed extraction, or unknown fee never becomes zero automatically.
2. Only reviewed, nondeleted worksheet-basis rides with complete, confirmed financial values contribute to final income totals. Pending duplicate decisions and unresolved relevant extraction conflicts block review.
3. Monetary values use integer paisa. The server validates inputs and calculates authoritative results with shared functions; browser calculations provide previews only.
4. Worksheet receipts must include tips before the stated subtraction is valid. Already-net earnings remain separate and cannot finalize in MVP without a complete, confirmed breakdown.
5. Financial values and their meaning require review regardless of OCR confidence. Parsing never invents fees, chooses between conflicting sources silently, or turns net earnings into cash.
6. Periods follow local trip dates, defaulting to `Asia/Dhaka`; monthly performance never inherits another month's balance.
7. Original files, exact OCR text, extraction evidence, corrections, and history remain recoverable. Editing or preprocessing never replaces the original image.
8. OCR, application assets, persistence, reporting, and exports must work offline after setup. No required CDN, account, external image upload, or paid service is introduced.
9. Restore validates and stages the complete dataset before replacement. A rejected or failed restore leaves the active data unchanged.

## 4. Decisions and ambiguities

These are proposed defaults unless the PRD already settles the point. Confirmed user preferences are recorded separately below.

| Topic | Proposed handling | Reason / limit |
| --- | --- | --- |
| Date and time required for review | Allow missing date/time in incomplete drafts; require valid trip date and pickup time for review | The workflow allows incomplete drafts, while the model only explicitly makes pickup time nullable for drafts. Making draft date nullable is a proposed schema clarification. |
| Missing route or distance | Permit review when finances and required date/time are complete; label missing route/distance and show coverage beside total distance | Explicitly required by the dashboard rules; missing distance must not appear as a measured zero. |
| Financial confirmation | Confirm all five financial fields and the worksheet interpretation for the current saved values | A checkbox tied to an older financial revision must not validate changed amounts. |
| Tips received separately | Keep draft until the user corrects/classifies receipts so the worksheet assumptions are true; preserve the original evidence | Do not invent an alternative finalized calculation basis in MVP or add tips silently. |
| Negative amounts or unusual results | Require explicit review and an explanation for an intentional adjustment; never accept negative OCR results without review | The PRD permits legitimate adjustments but does not define validation details. |
| Editing reviewed rides | Autosave an editing session separately; replace the saved ride atomically on Save after validation and any required re-confirmation | Typing must not silently alter published monthly totals. Invalid changes can be retained as an unfinished session. |
| Review metadata | Preserve `reviewed_at`, confirmation details, prior/new values, and timestamped changes | Status alone cannot explain which financial interpretation was confirmed. |
| Trash restoration | Preserve previous status and deletion time; revalidate review eligibility on restoration | `status = deleted` alone loses the previous draft/review state. Purge must not delete files still referenced elsewhere. |
| Screenshot trip ID | Store it as optional evidence; use exact IDs for stronger duplicate candidates, with comparison before action | Do not invent IDs or assume every screenshot layout includes one. |
| Duplicate records | Exact image hashes identify repeated files; trip similarity only flags candidates. Finalize separately only after an explicit decision and reason | Hash equality is not equivalent to duplicate ride identity; distinct screenshots can describe the same ride. An incoming candidate stays draft; its arrival must not remove an existing reviewed ride from totals. |
| Financial and OCR conflicts | Keep candidates with source evidence; require selection or explicit rejection of candidates before review | A missing value differs from a disagreement. Preserve both observations even after resolution. |
| Backup contents | Include drafts, rides, trash, active review sessions, history, settings, originals, and persisted OCR/provenance data | Previews may be regenerated if transforms are retained. Model binaries are installation assets, not user data. |
| Restore semantics | Replace the dataset after count preview and confirmation; do not merge in MVP | Explicitly matches the PRD. Validate schema compatibility and ensure originals and database switch together. |
| CSV contract | Keep a fixed, versioned header order; specify draft inclusion, calculated blanks, money formatting, and attachment references | The PRD requires stable documented headers but does not prescribe their complete order. Finalize before export implementation. |
| Upload limit units | Propose 20 files per batch and 10,000,000 bytes per file, shown consistently in UI and server validation | Makes the PRD's 10 MB limit testable; validate decoded image dimensions as well as file size. |

## 5. User preferences and external inputs

- **Initial supported operating systems:** user confirmed this Mac first. Keep portable path handling, but Windows/Linux installation acceptance is outside the initial release.
- **Representative screenshot availability:** user confirmed samples will be available before parser validation. Include real-layout validation in M3; no files are needed for planning. Earlier manual-entry and OCR development can use synthetic fixtures.
- **Workbook source:** unnecessary for this MVP because migration and balance reconciliation are excluded. Obtain it only when that later work is requested.

When screenshot samples arrive during development, record supported layouts and cover distinct trips, multiple views of one trip, already-net labels, conflicting values, amounts with decimals, and relevant payment/service types where examples exist. Keep private samples local or use sanitized repository fixtures.

## 6. Acceptance traceability

Task references point to [TODO.md](TODO.md). This table records planned traceability; completed checks are recorded in [final acceptance](FINAL-ACCEPTANCE.md); [M1 acceptance](M1-ACCEPTANCE.md) retains the first milestone evidence.

| ID | PRD scenario / requirement | Planned evidence | Tasks |
| --- | --- | --- | --- |
| A01 | Restart preserves saved data | Restart against a persistent test directory; verify rides, drafts, attachments, and sessions | M1-03, M1-05, M2-02, M5-02 |
| A02 | Offline OCR and full workflow | Install assets, block external network access, import a fixture, run real OCR, review, save, report, export, back up | M2-05, M5-01 |
| A03 | Unsupported screenshot layout | Raw OCR text remains visible; manual fields work; no invented amounts | M2-07, M3-01, M3-06 |
| A04 | Missing finance differs from zero | Null blocks review; explicit zero passes completeness; CSV preserves the distinction | M1-02, M1-07, M1-09 |
| A05 | 500 cash, 0 credit, 40 tips, 50 commission, 0 pass | Excluding tips = BDT 410.00; including tips = BDT 450.00 | M1-02 |
| A06 | 0 cash, 280.10 credit, zero deductions/tips | Both results = BDT 280.10 with exact minor-unit arithmetic | M1-02 |
| A07 | Already-net earnings only | Original meaning retained; remains draft; no double deduction | M1-02, M3-01 |
| A08 | Monthly pass charge | No periodic fee automatically becomes a per-ride deduction | M1-02, M3-01 |
| A09 | Same image twice | Hash warning before repeated OCR; compare, attach, skip, or resolve explicitly | M2-03, M3-04 |
| A10 | Two screenshots for one ride | Explicit grouping produces one ride and retains both image references | M2-04, M3-02 |
| A11 | Disagreeing extracted values | Both candidates visible; unresolved conflict blocks review | M3-02, M3-03 |
| A12 | Draft excluded from income | Aggregate queries exclude drafts, deleted rides, and unresolved duplicate candidates | M1-04, M3-04, M4-01 |
| A13 | Saved amount corrected | Confirmation and history updated; ledger and month totals recalculate | M1-05, M1-07, M4-01 |
| A14 | Month changed | Boundary-date fixtures select by local trip date without carry-forward | M1-04, M4-01 |
| A15 | CSV text and monetary values | BOM, Bangla, commas, quotes, newlines, formula-like text, nulls, zeros, negative numeric amounts, and header order verified | M1-09 |
| A16 | Backup restored on a fresh installation | IDs, relationships, settings, history, provenance, and original-file hashes match | M4-03, M4-04, M4-05 |
| A17 | OCR failure or cancellation | Remaining batch work continues; retry works; stale results cannot overwrite later work | M2-06, M2-08 |
| A18 | Intake controls and limits | Supported types, batch/file limits, invalid files, paste fallback, rotation/crop, and original retention verified | M2-01, M2-02, M2-04 |
| A19 | Safe editing, deletion, restoration | Refresh recovers edits; trash restores prior eligible state; purge respects shared files | M1-05, M1-06, M2-02 |
| A20 | Local API and file safety | Loopback binding, host/origin rejection, validated inputs, generated filenames, and path containment exercised | M1-03, M1-04, M2-02, M5-03 |
| A21 | Restore failure is nondestructive | Invalid schema, unsafe paths, missing/corrupt files, interrupted staging, and activation failure preserve existing data | M4-04, M4-05 |
| A22 | Filters, missing data, and accessibility | Filter consistency across ledger/export/dashboard scope; missing distance coverage; keyboard and narrow-screen walkthrough | M1-08, M4-01, M4-02, M5-04 |

## 7. Delivery risks

| Risk | Planned response |
| --- | --- |
| Real screenshots differ from parser fixtures | Ship real OCR plus manual review, label parsing experimental, report field-level validation only when samples exist. |
| Cash, credit, net payout, and tips are confused | Preserve labels/evidence, separate financial bases, require confirmation, and centralize calculations. |
| Database and attachment files diverge | Stage file writes, track ownership/references, clean abandoned work safely, and test restore activation failures. |
| Local OCR secretly requests remote assets | Serve worker/WASM/languages locally and test with external networking disabled. |
| Large images exhaust worker/browser memory | Bound processing concurrency, validate image dimensions, and test cancel/retry with the 20-file queue. |
| Too much work is bundled into the first milestone | Deliver persistent manual-entry accounting and CSV first, then intake/OCR, then parsing/duplicates, then reporting/recovery. |

No custom skill is needed for this planning task. The PRD and the linked plan/checklist provide project-specific guidance without adding another instruction layer.
