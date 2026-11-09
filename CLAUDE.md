# Claude Code Instructions — Uber Ride Tracker

This workspace contains the **Uber Ride Tracker** — a single-user, offline-first, localhost-only web app that records company-vehicle Uber rides from driver trip-summary screenshots, runs OCR locally, reconciles monthly income in BDT, and exports a CSV ledger.

## Engineering Architecture & Stack

- **Runtime:** Node 24 only (`engines: >=24.14.0 <25`). `node:sqlite` is required.
- **HTTP:** bare `node:http` `createServer` in `server/app.ts`. No Express/Fastify/Hono. Loopback bind only.
- **Persistence:** `node:sqlite` `DatabaseSync` in `server/store.ts`; migrations in `server/migrations/*.sql` gated by `PRAGMA user_version`.
- **Images:** `sharp`. **Archives:** `fflate`. **IDs and hashes:** `node:crypto`.
- **Frontend:** React 19.3 with the automatic JSX runtime, Vite 8, one plain stylesheet (`src/style.css`). No router, no state library, no component library, no CSS framework.
- **Shared logic:** `src/shared/` (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`) — pure, dependency-free, imported by both server and browser.
- **Testing:** `node:test` via `tsx` for `tests/*.test.ts`; Playwright for `tests/*.spec.ts`.

## Domain Invariants

- **Blank is not zero.** A missing amount is `null` and means unknown. Never coerce with `|| 0` or `?? 0`.
- **Integer paisa.** Money is stored as `*_paisa` integers and accumulated with `BigInt`. Decimals only at display and CSV boundaries.
- **Income formula:** `including = cash + credit - commission - pass`, then `excluding = including - tips`.
- **Reviewed-only income.** Only `status === 'reviewed'` rides with no `reviewErrors()` contribute. Drafts and trash contribute nothing.
- **The server is authoritative.** The browser previews; the server re-validates and recomputes.
- **Financial edits invalidate confirmation**, detected via `financialSignature()`.
- **The parser never invents.** An unrecognized layout yields zero observations. No silent pick between conflicts. No year inferred from map text.
- **Local dates, no carry-forward.** Never roll a date forward to complete an unfinished month.
- **A migration is two edits:** the new `.sql` file **and** its filename in `server/store.ts`. Never edit a released migration; keep `BACKUP_TABLES` in sync.
- **No external network at runtime.** OCR assets are served locally from `public/ocr/`. Never propose a CDN or a hosted model.

## Security

Never weaken the loopback guards (exact `Host` match, `Origin`, `Sec-Fetch-Site`, CSP, `nosniff`, `no-store`, path containment). Enforce body limits before buffering. The 500 response body is a fixed string — never interpolate a path, SQL text, or driver message.

## Git & Quality Rules

- Commits are **one plain declarative sentence** (sentence case, no `feat:`/`fix:` prefix, no body). Append an acceptance id when one applies: `Reject blank amounts as unknown rather than zero (A04)`.
- Explicit staging only (`git add <path1> <path2>`). Never `git add .` or `git add -A`.
- Run `npm run typecheck` and `npm test` before committing; add `npm run build` and `npm run test:e2e` for user-facing flows.
- Never push, merge, rebase, or amend without explicit authorization.
- Place AI-generated notes, reports, and plans in `docs/`. Agent state lives in the gitignored `.context/`.

## Modular Rules, Workflows & Skills

- Rules: `.claude/rules/`
- Workflows & Commands: `.claude/commands/`
- Skills: `.claude/skills/`
- Agents: `.claude/agents/`

All four are symlinks into `.agents/`, the single source of truth.