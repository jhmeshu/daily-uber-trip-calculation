# Local Uber Ride Tracker

A single-user app for this Mac: import screenshots, run real local OCR, compare and correct field candidates, confirm finances, save rides, view monthly income, export CSV, and create/restore complete ZIP backups. All defined MVP milestones are implemented. The [TODO](docs/TODO.md) records sequential milestone verification; the deferred backlog remains outside this delivery by user instruction.

## Install and start

Use **Node 24.14+ in the 24.x series** (tested with Node 24.18.1 and npm 11.16.0). If using nvm, run `nvm install` and `nvm use`.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4310**. Stop with Ctrl+C. `npm start` copies the locally installed OCR assets, checks TypeScript, builds the frontend, and starts the API/frontend on the same loopback server. Internet is needed for initial package installation; no account, API key or paid service is required. After installation, the core workflow uses only local files and SQLite. The app intentionally accepts its `127.0.0.1` URL rather than other hostnames.

React 19.3.0, Vite 8.3.3, TypeScript 7.0.2, Tesseract.js 7.0.0 and English language assets are locked by `package-lock.json`. SQLite uses Node's built-in `node:sqlite` module (experimental in Node 24). Keep default npm dependencies installed; build/start also use dev dependencies. Initial platform acceptance is macOS ARM64 on this Mac; Windows/Linux support is not claimed.

## Daily workflow

1. **Import:** choose, drag/drop or paste PNG/JPEG/WebP screenshots. Limit: 20 per batch and 10,000,000 bytes per file; decoded images must not exceed 40 million pixels. Clipboard support varies; use the file picker if paste is unavailable.
2. Each new image starts a separate trip group. Move screenshots into the same group only when they describe one trip, or separate them again. Exact-file duplicates offer comparison, reuse or skip. Reuse retains one immutable original and can reuse matching OCR.
3. Rotate/crop as needed, then open Review to read pending images automatically, or recognize them from Import. Recognition runs in a browser worker, one image at a time, with progress, retry and cancellation. Crop pixels refer to the rotated working image. Originals never change; transformation metadata and previous OCR runs remain available.
4. **Review:** compare images and raw OCR beside the form. Unambiguous candidates fill untouched blank fields automatically; existing manual edits are preserved. Use **Read screenshots / retry** in review to read again or recover from a failure. Conflicting observations need a chosen candidate or an explained current correction. Parsing is experimental. Missing amounts remain blank until you supply or confirm them. Cash collected also selects the **Cash** payment method. Pickup OCR removes a leading `?` marker. Duration uses `hh:mm:ss`. When cash and tips are known, **Net earnings** is cash collected minus tips; it updates as you correct those amounts. Missing tips remain unknown.
5. Supply the worksheet interpretation and confirm all five financial amounts before **Save reviewed**. Incomplete or already-net-only records remain drafts. Manual entry is available via **Add ride** regardless of OCR availability.
6. **Rides:** search/filter, edit with history, move to trash, restore, or permanently remove after confirmation. Possible duplicate trips stay drafts until attached, skipped via trash, or saved separately with an explanation. Attach preserves existing finances, source images and an audit snapshot; the incoming draft moves to trash with its history retained.
7. **Dashboard:** choose a month to see reviewed count, income, cash, credit, deductions, tips and measured-distance coverage. Draft and possible-duplicate counts are separate.
8. **Settings & backup:** choose the default timezone for new rides, inspect storage/OCR availability, download a complete backup or preview a restore. Existing local trip dates never shift when the default changes.

## Money and reporting

Enter BDT with up to two decimals; storage/calculation uses exact integer paisa. Blank means unknown; enter zero only when known. Drafts and trash never contribute to reviewed income.

Reviewed worksheet rides require date/time and known cash, Uber credit, tips, commission and explicitly evidenced per-ride pass values. Confirm that receipts include tips and precede the listed deductions:

```text
Income including tips = cash + Uber credit − commission − per-ride pass
Income excluding tips = income including tips − tips
```

The main KPI excludes tips. Neither income value represents profit after fuel, repairs or salary. Already-net earnings are preserved separately and cannot be finalized without a complete, confirmed breakdown. Monthly subscriptions are not repeated per-ride deductions. Negative amounts, tips above receipts or negative income require an intentional-adjustment explanation. Financial changes invalidate the form's confirmation.

Missing distance/route do not prevent financial review; coverage is visible and unknown distance is not a measured zero. Reporting uses stored local trip dates with inclusive date-range/month filters and no carry-forward.

## Data, updates and recovery

Default data root: `~/Library/Application Support/Uber Ride Tracker`. The database, original images and active-generation pointer live outside source/build output. To override the root or port:

```sh
UBER_DATA_DIR="/absolute/path/to/uber-data" PORT=4311 npm start
```

Use the same root on future starts. To update, stop the app, download a full backup, update source, run `npm ci` and `npm start`. Transactional migrations preserve data; newer unsupported schemas are rejected. Do not delete the data root during upgrades.

Unfinished edits autosave to separate SQLite sessions; immediate pending edits also stay in this browser's local storage. Refresh and choose **Resume**. Autosave failures are visible, and unsaved typing never changes reviewed totals. Concurrent stale saves are rejected. For a stale session, discard unfinished edits and reopen the current ride after retaining any needed text. Saving a reviewed revision writes its values, confirmation and history atomically.

OCR failure/cancellation affects that job; retry from Import or **Read screenshots / retry** in review. Restart converts unfinished jobs to interrupted. A browser refresh can leave a running job without a worker; **Recognize / retry** replaces its token. Late output is rejected. Manual entry remains available.

Trash retains previous status and deletion time. Restore revalidates financial eligibility. Permanent removal deletes the ride's sessions/history/confirmations and only removes originals no longer referenced by any trip group.

## Complete ZIP backup and restore

**Download full backup ZIP** includes every ride (drafts/trash too), original screenshots, exact OCR, transforms, observations/provenance, financial confirmations, correction/duplicate/attachment decisions, unfinished sessions, import state and settings. Previews and OCR model binaries are regenerated installation/working assets.

Format: `uber-ride-tracker`, backup version 1, database schema 3. `data.json` contains versioned table rows and an original-file manifest with relative paths, byte counts and SHA-256 hashes. Originals live under `originals/<uuid>.<extension>` in the ZIP. IDs and relationships are preserved. See [backup contract](docs/BACKUP-FORMAT.md).

Restore limits: 200,000,000 compressed bytes, 512,000,000 expanded bytes, 10,000 entries; individual images retain the 10,000,000-byte limit. Validation rejects unsupported schemas, unsafe/duplicate paths, ZIP checksum failures, corrupt data, invalid references/fields, mismatched hashes or missing/invalid images. A validated preview expires after 30 minutes. **Confirm replacement & restore** explicitly replaces the dataset; there is no merge mode.

The app stages a complete database and original-image directory under `generations/<uuid>`, then atomically changes `current.json` to activate both together. Existing generations remain on disk. An interruption before the pointer switch keeps the old dataset; after a completed switch, startup selects the complete new generation. Injected activation failures roll back the pointer and active connection. Staging rejects new mutations; uploads/edits spanning a dataset change are rejected.

For manual recovery, stop the app and copy the **whole data root** somewhere safe first. The original legacy dataset is at the root; restored datasets are in `generations/<uuid>`. Inspect the desired generation for `rides.sqlite` and `originals/`. Set `current.json` to `{"generation":null}` for the legacy dataset, or `{"generation":"<existing-generation-uuid>"}` for a retained generation, then start the app. Never edit/remove an active database or its WAL/SHM files while running. Retained generations consume disk space; remove an obsolete generation only while stopped, after verifying it is not the active pointer and you have a complete backup.

## Local OCR and real-layout limits

`npm run setup:ocr` copies the installed worker, all core JS/WASM variants and English traineddata into `public/ocr`, with a version/hash manifest. Builds copy these into `dist/ocr`. This runs automatically during build/start. No runtime CDN is required. If assets are unavailable, reinstall dependencies and rebuild. Asset sources: [Tesseract API/local paths](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).

Two real supplied driver-summary JPEGs were recognized and validated: cash, tips/unknowns, time, duration, distance and service mapping matched the recorded expectations. Route OCR has icon artifacts requiring correction. A day/month without a year stays unknown; map copyright does not supply a trip year. Uber Premier retains its exact source label and maps to the `Other` enum. Missing credit/commission/pass values are never inferred as zero. [Field-level validation](docs/REAL-LAYOUT-VALIDATION.md).

Two screenshots do not establish general extraction accuracy. Other layouts are provisional; unsupported labels retain raw OCR and manual review. Bangla digit normalization is supported in parsed text; Bangla OCR/language tuning and PaddleOCR are deferred. No general accuracy percentage is claimed.

## CSV contract (v1)

Export all reviewed rides or the current filtered selection; explicitly include drafts using the checkbox. Trash is never exported. Filters combine month, inclusive date range, payment, service, status and case-insensitive route/comment search. A draft-only selection exports no rows unless draft inclusion is checked.

UTF-8 BOM; CRLF rows; ISO dates; HH:mm:ss; numeric km with three decimals; BDT with two decimals. Unknown amounts are blank; zero is `0.00`. Calculable drafts may include preview incomes but retain draft status. User-controlled text starting with optional whitespace then `=`, `+`, `-` or `@` receives an apostrophe; numeric negatives keep their sign. Commas, quotes and newlines are escaped. Attachment references are relative and separated by semicolons. **CSV does not include images/history or a complete backup.**

Stable headers:

```text
id,status,calculation_status,trip_date,pickup_time,timezone,pickup_location,drop_location,distance_km,duration_seconds,payment_method,service_type,financial_basis,cash_collected_bdt,uber_credit_bdt,commission_bdt,pass_charge_bdt,tips_bdt,reported_net_bdt,income_excluding_tips_bdt,income_including_tips_bdt,financial_confirmed,adjustment_reason,comments,attachment_references,created_at,updated_at,reviewed_at
```

Calculation status is `unresolved` for nonworksheet bases, `incomplete` for missing worksheet amounts, and `complete` when all five amounts are known. It is separate from review status and financial confirmation.

## Verification and development

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Tests use isolated temporary data roots and synthetic fixtures; they do not write to normal user data. The full browser acceptance blocks external browser requests, uses a fresh context and the production build, runs actual OCR, reviews/saves, checks the dashboard, exports CSV, backs up/restores and restarts the app. This verifies application networking isolation, not a machine-wide network shutdown. [Final acceptance evidence](docs/FINAL-ACCEPTANCE.md).

`tests/fixtures/synthetic-trip.svg` is explicitly synthetic, and may be rendered to PNG for OCR testing. To rerun the supplied-sample comparison locally:

```sh
npx tsx scripts/validate-samples.ts /Users/janibulhoque/Downloads/uber
```

The report is written to `/tmp/uber-real-layout-report.json`; private screenshots are not copied into the repository.

For development, build the frontend then use `npm run dev` to restart the API on source changes. Rebuild after frontend edits. Accounts, LAN access, cloud sync, expenses/profit, historical spreadsheet migration and other deferred-backlog features are outside the delivered MVP.
