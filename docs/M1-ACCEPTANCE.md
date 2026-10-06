# M1 acceptance record

Date: 6 October 2026. Scope: manual-entry milestone only. All fixture rides are synthetic. No screenshot/OCR or complete backup acceptance is claimed.

Environment: macOS ARM64; Node 24.18.1; npm 11.16.0; React 19.3.0; TypeScript 7.0.2; Vite 8.3.3; built-in SQLite; Chromium through Playwright 1.63.0. Dependency versions are locked.

| Check | Evidence |
| --- | --- |
| Runtime and same-origin local app | TypeScript + production Vite build; localhost browser workflow |
| A01 restart persistence (M1 scope) | Close/reopen SQLite; reviewed ride and unfinished session retained |
| A04 missing versus zero | Null blocks review; explicit zero allows completeness; browser requires pass amount |
| A05 worksheet example | BDT 410 excluding tips / BDT 450 including tips |
| A06 decimal credit | Both income values exactly BDT 280.10 |
| A07 already-net-only | Unresolved calculation; cannot be reviewed; meaning retained separately |
| A08 monthly pass | No inferred periodic charge; unsupported input field rejected |
| A12 drafts/trash | Excluded from reviewed aggregation in unit, API and browser workflows |
| A13 correction | Saved history and confirmation revisions; browser BDT 410 → BDT 510 after explicit save; unsaved typing preserves BDT 410 |
| A14 period | Local September/October/November boundary fixtures and API month selection |
| A15 CSV | BOM, fixed headers, Bangla, commas, quotes/newlines, formula-like text, numeric negatives, blanks/zeros, filter and browser download |
| A19 M1 recovery/trash | Immediate refresh recovery; unfinished edits separate from reviewed values; trash/restore; confirmed permanent removal with related history cleanup |
| A20 M1 local API | Loopback listener; foreign origin/host/cross-site rejection; unknown inputs and authoritative totals rejected; revision conflicts |
| Atomic storage failures | Injected history and autosave failures preserve saved ride, confirmation count, session payload and revisions |
| Migrations | Injected migration failure rolls schema/version back; newer schema rejected |
| Narrow layout | 390px browser viewport; page fits width; table scrolls within container |

`npm test`: 11 passed. `npm run build`: passed. `npm run test:e2e`: 1 passed. The browser recorded no external requests or page errors. An out-of-order filter/restore response found during browser validation was corrected and the workflow rerun successfully. Final results are also recorded in TODO.md. M2 attachments/OCR, M3 conflicts/duplicates, M4 backup and M5 complete offline/accessibility acceptance remain pending.
