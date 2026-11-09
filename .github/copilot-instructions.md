# GitHub Copilot Instructions — Uber Ride Tracker

## General Context
This repository contains the **Uber Ride Tracker** — a single-user, offline-first, localhost-only web app that records company-vehicle Uber rides from driver trip-summary screenshots, runs OCR locally, reconciles monthly income in BDT, and exports a CSV ledger. There is no cloud, no API key, and no external network at runtime; that is a product requirement, not an accident.

## Engineering Guidelines

### Application & Architecture
- Runtime: Node 24 only (`engines: >=24.14.0 <25`). `node:sqlite` is required.
- Server: bare `node:http` `createServer` in `server/app.ts`. No Express/Fastify/Hono. Loopback bind on `127.0.0.1`, default port 4310.
- Database: `node:sqlite` `DatabaseSync` in `server/store.ts`. Schema in `server/migrations/*.sql`, gated by `PRAGMA user_version`.
- Shared logic: `src/shared/` (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`) — pure, dependency-free, imported by **both** server and browser. No `node:*` imports there.
- Frontend: React 19.3 with the automatic JSX runtime, Vite 8, one plain stylesheet `src/style.css`. Local `useState`/`useRef` only — no router, no state library, no component library, no CSS framework.
- Every relative import carries its extension (`'./store.ts'`). No path alias. Named exports only.
- Do NOT add a runtime dependency without an explicit user decision.

### Sacred Domain Invariants
- **Blank is not zero.** A missing amount is `null` and means unknown. Never `Number(x) || 0`, never `?? 0`, never prefill `0`.
- **Integer paisa.** Money is stored as `*_paisa` integers, accumulated with `BigInt`. Decimals exist only at display and CSV boundaries.
- **Income formula:** `including = cash + credit - commission - pass`, then `excluding = including - tips`.
- **Reviewed-only income.** Only `status === 'reviewed'` rides with `reviewErrors().length === 0` contribute.
- **The server is authoritative.** The browser previews; the server re-validates and recomputes.
- **Financial edits invalidate confirmation**, detected via `financialSignature()`.
- **The parser never invents.** An unrecognized layout yields zero observations. No silent pick between conflicting observations. No year inferred from map text.
- **Local dates, no carry-forward.** Never roll a date forward to complete an unfinished month.
- **A migration is two edits:** the new `.sql` file **and** its filename appended to the array in `server/store.ts`. Never edit a released migration. Keep `BACKUP_TABLES` in `server/backup.ts` in sync with `docs/BACKUP-FORMAT.md`.
- **Multi-step writes** run inside `store.transaction(...)`.

### Security
- Never weaken the loopback guards: exact `Host` match, `Origin` validation, `Sec-Fetch-Site`, CSP, `nosniff`, `no-store`, static-path containment.
- Enforce body limits before buffering: JSON 4.5 MB, images 10 MB, restore archive 200 MB.
- Declared MIME must match the `sharp`-decoded format. Reject archive entries with absolute paths, `..`, or symlinks.
- Never interpolate a path, SQL text, or a driver message into a response. The 500 body is a fixed string.
- No CDN, no remote fonts, no runtime fetch to any third party. OCR assets are served locally from `public/ocr/`.

### Code Style & Testing
- Strict TypeScript, `noEmit`. No `any`, no `@ts-ignore`.
- Dense house style is intentional: single quotes, semicolons, 2-space indent, statements packed onto one line, long lines normal, rare `//` comments for non-obvious invariants only. No formatter is configured — do not reformat untouched code.
- Tests: `tests/*.test.ts` → `node:test` via `tsx` (`npm test`, flat top-level `test()` calls, no `describe()`). `tests/*.spec.ts` → Playwright (`npm run test:e2e`), which selects only by role and accessible name.
- Tests must use `mkdtempSync` data roots. Never point a test at the real data directory.
- Verify with `npm run typecheck` and `npm test` before committing.
- Commits: one plain declarative sentence, sentence case, no `feat:`/`fix:` prefix, no body. Append an acceptance id when one applies. Explicit file staging only — never `git add .` or `git add -A`.
- AI docs: write new documentation and reports to `docs/`. Agent state goes to the gitignored `.context/`.