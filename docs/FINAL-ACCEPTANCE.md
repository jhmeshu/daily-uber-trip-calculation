# Final MVP acceptance

Completed on 6 October 2026 on this Mac (macOS ARM64, Node 24.18.1, npm 11.16.0, Chromium/Playwright 1.63.0). The user requested sequential completion with testing after each milestone, then explicitly selected the defined MVP rather than the deferred backlog.

| Milestone gate | Result before the next milestone |
| --- | --- |
| M1 manual accounting/CSV | Build passed; 11 domain/storage/API tests and 1 browser workflow passed |
| M2 images/local OCR | Build passed; 12 automated tests and 2 browser workflows passed |
| M3 parsing/evidence/duplicates | Build passed; 15 automated tests and 2 browser workflows passed; supplied real screenshots validated |
| M4 dashboard/complete restore | Build passed; 16 automated tests and 3 browser workflows passed |
| M5 release | Build passed; 18 automated tests and 4 browser workflows passed |

Final commands: `npm run build`, `npm test`, `npm run test:e2e`. All pass. Tests use isolated temporary roots; no synthetic records are inserted into normal user data. `npm audit` reported no vulnerabilities during dependency installation. The lockfile includes the OCR engine/core and English model package; build/start copy all assets locally.

## Acceptance traceability

| ID | Verified evidence |
| --- | --- |
| A01 | SQLite close/reopen; draft sessions and originals persist; complete offline workflow restarts server/Store after restore and verifies saved ID/income/image hash |
| A02 | Fresh browser context against production build; external browser requests forcibly aborted; import → actual worker/WASM/local English OCR → review/save → dashboard → CSV → ZIP backup/restore → app restart; no external requests or page errors |
| A03 | Unsupported synthetic OCR returns no invented amounts; raw OCR and manual form remain; real images retain missing dates/fees |
| A04 | Null/zero distinction in domain, review form and CSV; missing amount blocks financial review |
| A05 | Both expected results: BDT 410 excluding tips, BDT 450 including tips |
| A06 | BDT 280.10 credit calculated exactly in integer paisa |
| A07 | Already-net-only stays unresolved/draft; no cash or fee inference |
| A08 | Monthly pass never becomes a per-ride parser candidate or default charge |
| A09 | Browser exact-hash warning, compare/reuse/skip; duplicate MIME validation; possible-trip decisions rechecked on save |
| A10 | Explicit group move retains two image references for one draft/review; originals remain shared safely |
| A11 | Two synthetic source observations with conflicting cash; review blocked until explicit selection/correction; all source runs and observations retained |
| A12 | Draft/trash excluded from reviewed aggregation; incoming duplicate does not remove existing reviewed income |
| A13 | Browser financial correction invalidates confirmation; typing keeps saved BDT 410; explicit reviewed save changes it to BDT 510; history and confirmations updated atomically |
| A14 | September/October/November local-date fixtures, API month filter and dashboard selection; timezone changes do not shift stored trip dates |
| A15 | Stable headers, HTTP BOM bytes, UTF-8/Bangla, commas, quotes/newlines, formula-like text, blanks/zeros and numeric negatives; relative original-image references; browser CSV download |
| A16 | Fresh-install ZIP round-trip compares every backed-up table, stable IDs and original SHA-256; browser preview/confirmed replacement |
| A17 | Actual browser worker cancellation/retry, stale token rejection, failed/interrupted job state and restart recovery; existing reviewed data stays unchanged |
| A18 | Client/server batch/type/byte limits, actual image decode, crop bounds, rotation/working derivative and unchanged original; picker/drag/paste UI with documented browser fallback |
| A19 | Immediate refresh recovery; injected browser autosave failure retains pending edits and shows error; history-write rollback; trash/restore/purge and shared-file ownership |
| A20 | IPv4 loopback listener, unexpected host/origin/cross-site rejection, invalid request fields/IDs/images and file paths; safe generated storage keys; no raw paths in exports |
| A21 | Unsupported schemas, unsafe/duplicate ZIP paths, checksums/corruption, expansion limits, invalid relationships, missing/hash-mismatched images; injected staging and before-activation/after-pointer/after-open failures preserve original dataset |
| A22 | Shared filter definitions and CSV scope; missing distance/route coverage; keyboard navigation across dashboard/import/settings/rides and review at 390px, no page overflow; labels, progress and destructive confirmations exercised |

## Real screenshots and limits

The two supplied JPEGs were recognized successfully earlier in this session with local Tesseract, and each matched all 11 asserted field outcomes, including intentionally unknown values. See [field-level validation](REAL-LAYOUT-VALIDATION.md). Their observed file sizes were 252,544 and 288,221 bytes and widths 1,080px. Route OCR has icon artifacts requiring manual correction. This is limited driver-summary coverage, not general extraction accuracy; parsing remains visibly experimental.

The 20-file restart/storage test uses 20 distinct synthetic 1080×1000 JPEGs with approximately 280 KB of padding to exercise comparable file-byte volume while preserving valid decodable image content. Count/type/size rejection and original hashes are checked. An additional attempt to re-read the supplied files for a repeated-real-image batch, and a later validation rerun, were denied by macOS with `EPERM` on Downloads. The earlier successful real-layout results are retained; no later real-batch pass is claimed. The optional `scripts/check-local-batch.ts` can rerun that check when Downloads access is available.

Network isolation was applied to the browser application's requests, including worker/core/language assets; this was not a machine-wide network shutdown. Clipboard support depends on the browser. Bangla OCR tuning, additional real layouts, Windows/Linux acceptance, accounts/LAN/cloud sync, historical spreadsheets and expense/profit features remain outside the defined MVP.

## Release fixes found by checks

Browser validation found and resolved out-of-order filter/restore results, initial settings overwriting typed timezone, and asynchronous candidate application needing editing controls to stay disabled until complete. Release validation fixed duplicate-image MIME checks, rejected mutations spanning dataset replacement, and preserved the incoming draft/history when attaching sources to an existing ride. ZIP checksums and durable generation-pointer/image writes were checked. All applicable automated suites passed after these changes.

## Live delivery check

An earlier M1 process was running at `127.0.0.1:4310` from this project. It was stopped gracefully, its full data root copied to the sibling `Uber Ride Tracker-pre-upgrade-20261006-123918`, and the completed app started with `npm start`. Live health reports schema 3 and local OCR availability. The pre-existing dataset contained zero rides; record equality was checked after migration. The app remains running at **http://127.0.0.1:4310**.


## Screenshot-reading repair — 6 October 2026

The uploaded original was valid, but Review did not initiate OCR and offered no reading control. Review now automatically reads pending screenshots, displays progress and cancellation, and offers **Read screenshots / retry**. Unambiguous suggestions populate untouched blank fields after pending images have finished. Conflicting values remain unresolved. Manual changes, including intentionally cleared fields, are tracked in the unfinished session and survive recovery and full backups. Financial interpretation and confirmation remain explicit.

OCR initialization errors are surfaced through Tesseract's error handler; recognition has a two-minute timeout. The source image and manual form remain available when recognition fails.

Validation: `npm run build`, `npm test` (18 passed), and `UBER_OCR_SAMPLE=/tmp/uber-uploaded-regression.jpeg npm run test:e2e` (8 passed). The private JPEG was retrieved from the user's already-uploaded original into a temporary local file; it is not a repository fixture. Direct Review produced cash BDT 596.24, pickup time 11:58:00, distance 12.550 km and duration 3214 seconds. Missing trip date and tips remained blank. No financial basis or confirmation was inferred. Tests also covered direct-reading cancellation/retry, model initialization failure/recovery, manual corrections and blank fields surviving session recovery, and conflicting grouped screenshots.

The installed local server was restarted after saving a complete safety backup. Health, local OCR assets and the new production bundle were verified; the complete ride listing, unfinished editing sessions and import/screenshot records matched the pre-restart snapshot. This repair adds no claims about general OCR accuracy.


## Screenshot field corrections — 6 October 2026

Cash collected evidence also supplies Payment method Cash. Leading question marks are removed from pickup candidates and recovered review forms. Raw OCR remains unchanged; old icon-prefixed observations remain in history while the current parser excludes them. Duration editing and ride-table display use hh:mm:ss; numeric seconds remain the stored/API/CSV value, with legacy unfinished forms converted on recovery. Net earnings uses cash collected minus known tips and updates when either amount is corrected. Missing or conflicting inputs are not inferred. Worksheet income calculations continue to account for their separately reviewed deductions.

Validation: build passed; `npm test` passed 21 tests; `UBER_OCR_SAMPLE=/tmp/uber-uploaded-regression.jpeg UBER_OCR_TIP_SAMPLE=/tmp/uber-tip-regression.jpeg npm run test:e2e` passed nine workflows. Both private supplied JPEGs were read using actual local OCR. The tipped sample produced BDT 407.38 cash, BDT 40.00 tip and BDT 367.38 net, Cash payment and 00:39:10 duration; corrected cash BDT 500.00 yielded BDT 460.00 net. Duration 01:02:03 saved as 3723 seconds and appeared formatted in the ride table. Parser history, conflicts, manual edits, cancellation, recovery, offline operation, exports and backups passed regression coverage. The local app was restarted after a safety backup. Ride and import records matched before/after; the existing unfinished session remained intact and concurrent autosave advanced its revision from 3 to 4, changing only payment method to Cash. The new browser bundle and local OCR availability were verified.


## Pickup and drop-off icon cleanup — 6 October 2026

The location cleaner now removes pin/dot markers and their OCR forms (including question marks, copyright/registered signs, circles, bullets and pin symbols) from both pickup and drop-off values, including wrapped country lines. It preserves legitimate address characters such as numbers, hashes, slashes, Bangla text and internal punctuation. Original OCR text and older observations remain available. Cleanup applies to parser candidates, recovered review sessions, route-table display, validated saved input and CSV exports.

Build passed; 23 automated tests and nine browser workflows passed with both supplied JPEGs. `scripts/validate-samples.ts` was updated for the user's cash-minus-tip rule and payment mapping; both original JPEGs passed 12/12 expected field assertions. Browser checks confirmed both address fields exclude the icon artifacts. The local server was restarted after a complete safety backup; ride, session and import records matched before/after and the new build/local OCR availability were verified.
