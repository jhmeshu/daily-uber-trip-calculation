# PRD: Local Uber Ride Tracker with Screenshot Import

Version: 1.0 · Date: 6 October 2026 · Owner: Janibul Hoque

## 1. Product goal

Build a single-user web app that runs on localhost, reads Uber trip screenshots using free local OCR, fills an editable ride form, stores reviewed records locally, calculates income, and exports CSV. The core workflow must work without an AI subscription, API key, cloud database, paid service, or ongoing internet connection after installation and OCR asset download.

This PRD is intended to be supplied directly to an AI coding assistant. Implement a working application, not only a UI mockup.

## 2. Source and scope

The attached snapshot of **Copy of Uber Calculation 2026.xlsx** is the reference for fields and reporting needs. It contains March, July, August, September and October ride sheets, along with vehicle-cost comparisons. This PRD is based on that snapshot; the original Google Drive workbook has not been refreshed.

Observed problems that the new app must avoid:

- October K3, K4 and K7 reference the previous row instead of their own ride.
- October P78 carries forward August Q81; the intended September closing balance needs reconciliation before migration.
- October contains copied September labels and July work logs.
- October rows 4 and 5 share a screenshot link despite describing different trips.
- Monthly columns differ, and ride records, notes, expenses and driver work logs are mixed together.

Do not reproduce spreadsheet row-dependent formulas or automatically import historical closing balances as verified values.

## 3. Users and expected workflow

Primary user: an office operations employee recording company vehicle Uber rides and reconciling monthly income.

1. Start the app locally and open it in a browser.
2. Upload or paste one or several screenshots.
3. Select which screenshots belong to the same trip; never assume all uploaded images represent one ride.
4. Run OCR and see extracted fields beside the original images.
5. Correct uncertain values and explicitly confirm missing financial amounts or enter zero where appropriate.
6. Save a reviewed ride, or retain an incomplete draft.
7. Filter rides by month and view income summaries.
8. Export filtered records as CSV and create a full backup when needed.

## 4. MVP requirements

### 4.1 Screenshot intake

- Accept PNG, JPEG and WebP files through file selection and drag-and-drop; support clipboard image paste where the browser permits it.
- Allow batch intake with a visible queue, per-file status, progress, retry and cancel.
- Default limit: 20 images per batch and 10 MB per image; display actionable validation errors.
- Keep original image files, generated previews, image hashes, raw OCR text, engine version and extraction results.
- Provide rotation and optional crop before OCR. Keep the original intact.
- Let users attach multiple images to a trip, remove an attachment or regroup images before saving.

### 4.2 Free OCR and field mapping

- Use Tesseract.js as the initial OCR engine. Bundle or locally serve its worker, WASM and language assets; do not depend on a CDN at runtime.
- Start with English screenshots. Structure language support so Bangla can be added with local language assets and parser tests.
- Separate OCR from field parsing: recognize text first, then use labels, text positions and deterministic rules to map it to fields.
- Normalize whitespace, currency markers, English/Bangla digits where encountered, decimal separators, dates, times, distances and durations conservatively.
- Never use a generative model or paid API in the required workflow.
- Keep the OCR engine behind an adapter so a locally installed PaddleOCR service can be evaluated later without rewriting the form or calculations.
- Prefer explicit screenshot labels. An amount labelled earnings/net payout must not automatically become cash collected or gross fare.
- Conflicting values from multiple images must be displayed as alternatives for user selection. Do not silently choose one.
- Display raw text so unsupported screenshot layouts remain usable through manual entry.
- Mark each field as extracted, corrected, manually entered or missing. Preserve source image and text evidence where available.
- OCR confidence is only a review aid, not a guarantee that the field meaning is correct. Highlight all financial values for review in v1.

Actual Uber screenshots have not yet been supplied. Build the intake, OCR, review and manual-entry flow now; label field parsing experimental until representative screenshots are tested. Do not claim a measured extraction accuracy without real test images.

### 4.3 Review and save

- Use a side-by-side screenshot viewer and editable form on desktop, stacked on narrow screens.
- Support zoom, image switching, field editing and recalculation before save.
- Distinguish blank/unknown from an explicitly confirmed zero.
- Save incomplete records as drafts. Drafts must not contribute to finalized income totals.
- Require explicit confirmation of the financial interpretation before a record is marked reviewed.
- Persist draft edits so refreshing the page does not lose the review session.
- Allow edits to saved rides with a timestamped change history and recalculated summaries.
- Deletion requires confirmation and supports restoration from a trash view until permanently removed.

### 4.4 Ride ledger and dashboard

- Display date/time, route, distance, payment method, service type, cash, credit, commission, tips, income and review status.
- Filter by date range, month, payment method, service type and status; search locations/comments.
- Show reviewed ride count, total distance, cash collected, Uber credit, commission/pass, tips, income excluding tips and income including tips.
- Show draft and possible-duplicate counts separately.
- Derive periods from trip dates, not manually named monthly tabs.
- Show which reviewed records lack distance or route information; do not treat missing distances as measured zero.

### 4.5 CSV export

- Export all reviewed rides or the current filtered selection. Offer a separate explicit option to include drafts and their status.
- Use stable documented headers, UTF-8 with BOM, ISO dates, 24-hour times, numeric distance without a unit suffix, and numeric BDT values.
- Quote commas, quotes and line breaks correctly. Blank amounts remain blank; confirmed zero exports as zero.
- Protect user-controlled text against spreadsheet formula injection while preserving ordinary numeric values.
- Include ride ID, review status, calculation status and relative attachment references. Do not export raw filesystem paths.
- CSV does not contain screenshots or a full database backup; explain this in the export screen.
- Filename example: uber-rides-2026-10.csv.

### 4.6 Backup and restore

- Provide a downloadable ZIP containing a versioned JSON data export and original attachments.
- A restored backup must preserve rides, drafts, attachments, provenance, corrections and settings.
- Validate archive structure, schema version and safe paths before restoration. Preview record counts and require confirmation before replacing existing data.
- A rejected or failed restore must leave the existing database unchanged.
- CSV export must not be presented as the only backup option.

## 5. Data model

Use stable UUIDs; sequential display numbers are generated for the current view.

| Field | Type / behavior |
| --- | --- |
| id | UUID |
| trip_date | Local calendar date, YYYY-MM-DD |
| pickup_time | Local time, HH:mm:ss; nullable for draft |
| timezone | Asia/Dhaka by default |
| duration_seconds | Nonnegative integer or null |
| pickup_location / drop_location | Text or null |
| distance_meters | Nonnegative integer or null; render/export as km |
| cash_collected_paisa | Integer BDT minor units or null |
| tips_paisa | Integer or null |
| uber_credit_paisa | Integer or null |
| commission_paisa | Integer or null |
| pass_charge_paisa | Integer or null; only a per-ride charge when explicitly evidenced |
| service_type | Uber X, Uber Premium, Other, Unknown |
| payment_method | Cash, bKash, Other, Unknown |
| comments | Text |
| financial_basis | worksheet_cash_plus_credit, already_net, or unresolved |
| reported_net_paisa | Optional directly reported net earnings; preserve original meaning |
| status | draft, reviewed, deleted |
| created_at / updated_at / reviewed_at | Timestamps |
| attachments | Related local image records with hash and source filename |
| field_provenance | Evidence, extraction confidence and correction history per field |

Store BDT as integer paisa and duration as seconds. Derived amounts must be computed by shared calculation functions, not accepted from the client as authoritative totals. Retain the exact OCR text even when normalized values change.

An optional screenshot trip ID can be stored when present; do not require or invent it.

## 6. Calculation rules and accounting boundaries

The workbook's current per-ride calculation is cash + Uber credit − Uber commission/pass − tips. Treat this as the **worksheet basis**, not a universal description of Uber accounting.

For worksheet-basis rides, cash and credit must represent amounts before the separately recorded deductions. Assume tips are included in those receipts only after the user confirms this basis. Then calculate:

```
receipts = cash_collected + uber_credit
deductions = commission + per_ride_pass_charge
income_including_tips = receipts - deductions
income_excluding_tips = receipts - deductions - tips
```

- Block finalized worksheet-basis totals until cash, credit, tips, commission and pass charge have known values, including explicit zeros.
- Show both income including tips and excluding tips. Default the main workbook-compatible KPI to income excluding tips and label it clearly.
- If tips were received separately from the entered receipts, require correction/explicit classification; do not subtract them from those receipts blindly.
- If a screenshot only shows already-net earnings, preserve that amount separately, keep the record as a draft in MVP and request a complete breakdown before finalization. Do not deduct commission twice.
- Periodic Uber pass/subscription charges belong to the expense ledger. Never apply the full monthly charge to every ride.
- Net ride income is not profit after fuel, repairs and salary; label it accordingly.
- Never infer a commission percentage or a missing fee from payment method or service type.
- Warn on tips greater than receipts and unusual negative results. A legitimate adjustment may be retained with an explanation; negative OCR amounts require review.
- Calculate with integer minor units and format to two decimal places only for display/export.

Monthly totals are computed directly from reviewed, nondeleted rides whose local trip date falls in the selected month. No carry-forward is needed for monthly ride performance. Any historical opening balance requires a separate reconciled entry in a future balance ledger.

## 7. Duplicate prevention

- Detect exact duplicate images by file hash and notify before processing again.
- Flag possible duplicate trips using date, time, route, distance and amounts; use a trip ID when available.
- Display matching records for comparison. Allow attach-to-existing, skip, or save separately with a reason.
- Duplicate file detection must not prevent a user attaching a second view of the same ride.
- Do not silently delete, merge, replace or count a pending duplicate as a reviewed ride.

## 8. Technical direction

Suggested implementation: React + TypeScript frontend, a Node.js/TypeScript localhost API, SQLite database and local attachment directory. Use Tesseract.js in a web worker to keep the interface responsive. Alternative libraries are acceptable when they preserve the requirements and free local operation.

- Bind the server to 127.0.0.1 by default; do not expose it to the network automatically.
- Serve the built frontend and API from the same local server for normal use.
- Choose maintained compatible dependency versions during implementation and include a lockfile.
- Document Node prerequisites, first-run setup, OCR asset installation and an uncomplicated start command.
- Use a configurable persistent data directory outside disposable build folders. An app upgrade must not erase data.
- Validate files and input on the server, use generated attachment filenames, constrain file paths and enforce upload limits.
- Apply database migrations transactionally and retain backup compatibility through explicit schema versions.
- Reject unexpected cross-origin mutation requests and validate host/origin for the local API.
- No telemetry, external image upload, third-party account, cloud synchronization or remote AI calls by default.
- Internet may be required for initial package/model installation. After setup, screenshot import, OCR, editing, reporting and exports must pass an offline test.

## 9. Screens

1. **Dashboard:** month selector, reviewed totals, draft/duplicate counts and recent rides.
2. **Import:** upload/paste, batch queue, grouping, OCR status and recovery controls.
3. **Review:** original images, extracted fields, financial confirmation, raw text and save/draft actions.
4. **Rides:** searchable/filterable ledger, edit, trash and CSV export.
5. **Settings and backup:** data location, timezone, OCR availability, backup/restore and calculation explanation.

Use a clean, readable interface with BDT currency formatting, clear validation and keyboard-accessible controls. Do not show developer terminology as unexplained instructions to the user.

## 10. Later phases

Keep these outside MVP unless needed to fulfill an explicit later request:

- XLSX migration with separate mappings for March, July and August–October; preview proposed rows, recalculate formulas and exclude notes/work logs/placeholders.
- Fuel/repair/pass expense ledger, odometer entries, Uber versus office-use distance allocation and profit reports.
- Driver working-hour logs and office-versus-vendor cost comparisons.
- Local PaddleOCR adapter, Bangla-specific tuning and additional screenshot layouts.
- XLSX export, LAN access and multiple users.

An XLSX import must never blindly trust cached formula values or the suspect carry-forward cells.

## 11. Acceptance criteria

| Scenario | Expected outcome |
| --- | --- |
| App restarted | Saved rides, drafts and attachments remain available |
| Internet disabled after setup | OCR and the full save/export workflow still work |
| OCR cannot parse a layout | Raw text and manual-entry form remain available; no invented values |
| Financial amount absent | Field stays null; record remains draft until confirmed |
| Cash 500, credit 0, tips 40, commission 50, pass 0 | Income excluding tips = BDT 410; including tips = BDT 450 |
| Cash 0, credit 280.10, tips 0, commission 0, pass 0 | Both income values = BDT 280.10 |
| Already-net amount only | Preserve amount and require breakdown; do not subtract fees again |
| Monthly pass charge | No automatic repetition across rides |
| Same image uploaded twice | Duplicate warning and comparison/attachment actions |
| Same ride shown in two images | User can group them into one ride |
| Extracted values disagree | Conflict is visible and requires user resolution |
| Draft ride present | Excluded from finalized dashboard totals |
| Saved amount corrected | Ride and monthly totals recalculate without row-reference errors |
| Month changed | Totals follow trip dates and never include copied prior-month labels |
| CSV contains Bangla, commas, quotes and newlines | Opens with intact text and consistent columns |
| Backup restored to a fresh installation | Records, attachments and provenance match the original |
| OCR task fails or is cancelled | Batch can continue; reviewed data is preserved |

Test financial calculations, null handling, duplicate logic, export escaping, restore integrity and persistence. Use synthetic parser fixtures initially, explicitly labelled synthetic. Add end-to-end extraction tests with representative real screenshots once supplied; report field-level results and failures instead of asserting an untested accuracy percentage.

## 12. Delivery instructions for the AI builder

Deliver runnable source, setup instructions, dependency lockfile, database migrations, bundled/local OCR asset setup, sample synthetic data and meaningful automated tests. Include a README describing data location, backup, financial assumptions, known extraction limitations and the offline setup procedure.

Build in this order:

1. Persistent ride CRUD, draft/review states, correct calculations and CSV export.
2. Screenshot intake, attachment storage, local OCR and review UI.
3. Parser rules, provenance, grouping and duplicate handling.
4. Dashboard, backup/restore and offline verification.

Do not stop at a mockup or use simulated OCR in the completed product. When real screenshots are unavailable, ship working OCR and manual review, document the provisional parser, and state which layouts still need testing. Do not require payment or an AI subscription to complete the core flow.
