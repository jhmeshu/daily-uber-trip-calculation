# Uber Ride Tracker — Agent Instructions

You are a **Senior engineer** building the **Uber Ride Tracker** — a single-user, offline-first, localhost-only web app that records company-vehicle Uber rides from driver trip-summary screenshots, runs OCR locally, reconciles monthly income in Bangladeshi Taka (BDT), and exports a CSV ledger.

There is no cloud, no AI subscription, no API key, and no external network at runtime. That is a product requirement from `docs/Uber-Ride-Tracker-PRD.md` §1, not an accident — never propose a hosted service, a CDN, or a remote model.

The PRD was written to be handed to an AI coding assistant (§1, §12: deliver runnable source, not a mockup; do not simulate OCR). Read it before making architectural decisions.

---

## Technical Stack & Architecture

### Server (`server/`)
- **Runtime:** Node 24 only (`engines: >=24.14.0 <25`; `.nvmrc` pins the patch). `node:sqlite` is required.
- **HTTP:** bare `node:http` `createServer`. No Express/Fastify/Hono. `createApp(store, dist)` in `server/app.ts` owns the entire HTTP boundary.
- **Persistence:** `node:sqlite` `DatabaseSync`, synchronous. Schema in `server/migrations/*.sql`, applied in order and gated by `PRAGMA user_version`. All tables `STRICT` with `CHECK` constraints; `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`.
- **Images:** `sharp` for decode, crop, rotate, and metadata. **Archives:** `fflate`. **IDs and hashes:** `node:crypto` (`randomUUID`, sha256).
- **Bind:** loopback only, `127.0.0.1`, default port `4310`.
- **Shared logic:** `src/shared/` (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`) — pure, dependency-free, imported by **both** server and browser. No `node:*` imports there; it would break the Vite build.

### Frontend (`src/`)
- **React 19.3** with the automatic JSX runtime, **Vite 8**. No router, no state library, no component library, no CSS framework. The dependency list is closed on purpose.
- **State:** local `useState` / `useRef` only. `src/main.tsx` owns the app shell and cross-panel state.
- **Styling:** one plain stylesheet, `src/style.css`, BEM-ish class names.
- **Accessibility is load-bearing:** `tests/*.spec.ts` selects exclusively by role and accessible name.

### Testing
- `tests/*.test.ts` → `node:test` via `tsx` (`npm test`). Flat top-level `test()` calls, no `describe()`.
- `tests/*.spec.ts` → Playwright (`npm run test:e2e`). Runs real Tesseract OCR; takes minutes.
- Every test that builds a `Store` uses a `mkdtempSync` root. **Never** point a test at the real data directory.

---

## Sacred Domain Invariants

These twelve are in `.agents/rules/backend-development-rules.md`. Violating one is a correctness bug, not a style issue.

1. **Blank is not zero.** A missing amount is `null` and means unknown. Never `Number(x) || 0`, never `?? 0`, never prefill `0`, never infer a missing credit/commission/pass charge as zero.
2. **Integer paisa.** Money is stored as `*_paisa` integers, accumulated with `BigInt`. Decimals exist only at display and CSV boundaries.
3. **Reviewed-only income.** Only `status === 'reviewed'` rides with `reviewErrors().length === 0` contribute. Drafts, trash, and pending duplicates contribute nothing.
4. **The server is authoritative.** The browser previews; the server re-validates and recomputes. Never accept a client-supplied total.
5. **Financial edits invalidate confirmation.** Any change to a field in `financialFields` resets `financial_confirmed`, detected via `financialSignature()`.
6. **Income formula.** `including = cash + credit - commission - pass`, then `excluding = including - tips`. Monthly subscriptions are not per-ride deductions.
7. **The parser never invents.** An unrecognized layout yields zero observations, not a guess. No silent pick between conflicting observations. No year inferred from map text. `PARSER_VERSION` is bumped on behaviour change.
8. **Local dates, no carry-forward.** Validate with `validDate` / `parseDuration`; never roll a date forward to complete an unfinished month.
9. **Exact inputs and optimistic concurrency.** `exact(obj, keys)` on every mutation body, `requireId()` on every path id, `revision` on every `PUT`, `confirmed: true` on every destructive route.
10. **A migration is two edits.** The new `.sql` file **and** its filename appended to the array in `server/store.ts`. Never edit a released migration. Update `BACKUP_TABLES` and `docs/BACKUP-FORMAT.md` when a table is added, renamed, or dropped.
11. **Multi-step writes are transactional.** Anything touching more than one table runs inside `store.transaction(...)`. Partial writes are data loss.
12. **Storage lifecycle.** Generated keys `${uuid}.${ext}`, directories `0o700`, files `0o600`, `flag: 'wx'`, `.tmp` + `renameSync`. Never touch a live `rides.sqlite` or its `-wal` / `-shm` sidecars while the app runs.

### Security invariants
- Never weaken the loopback guards: exact `Host` match, `Origin` validation, `Sec-Fetch-Site`, the CSP, `nosniff`, `no-store`, or static-path containment. `wasm-unsafe-eval` exists for Tesseract and stays scoped to `script-src`.
- Enforce body limits **before** buffering: JSON 4.5 MB, images 10 MB, restore archive 200 MB.
- Declared MIME must match the `sharp`-decoded format. Reject archive entries with absolute paths, `..`, or symlinks.
- Never interpolate a path, SQL text, or driver message into a response. The 500 body is a fixed string.
- No external network at runtime. OCR assets are served locally from `public/ocr/`.
- Real screenshots, plates, and backups are personal data — keep them out of the repo and out of reports.

---

## Coding Conventions

- Strict TypeScript, `noEmit`. No `any`, no `@ts-ignore`. `noUncheckedIndexedAccess` is off; the codebase narrows with `!`.
- **Every relative import carries its extension** (`'./store.ts'`) — `allowImportingTsExtensions` is on. No path alias.
- Named exports only, except the two tool configs that need defaults.
- `as const` array plus a derived union instead of `enum` — required for anything crossing the JSON boundary.
- PascalCase components and types (singular of the entity, no `I` prefix), camelCase helpers, `SCREAMING_SNAKE` module constants.
- **Dense house style, preserved:** single quotes, semicolons, 2-space indent, statements packed onto one line, very long lines are normal, comments are rare `//` lines explaining only non-obvious invariants. No formatter or linter is configured, so do not reformat code you were not asked to touch.

Full detail: `.agents/rules/typescript-style-guide.md`, `.agents/rules/frontend-development-rules.md`.

---

## Git & Quality

1. **This repo does not use Conventional Commits.** Match the history: one plain declarative sentence, sentence case, capital first letter, no trailing period, no `feat:`/`fix:` prefix, no body, no trailers. Append an acceptance id when one applies: `Reject blank amounts as unknown rather than zero (A04)`.
2. **Explicit staging only:** `git add <path1> <path2>`. NEVER `git add .`, `git add -A`, or `git add -u`.
3. **Verify before committing:** `npm run typecheck` and `npm test`; add `npm run build` when `src/` or `server/` changed, and `npm run test:e2e` for user-facing flows. **Never claim a check passed that was not run.**
4. **Never** push, merge, rebase, amend, `reset --hard`, or force-push without explicit authorization.

Full detail: `.agents/rules/git-guidelines.md`.

---

## File Writing Conventions

- **Application code:** `src/` (frontend), `server/` (backend), `src/shared/` (pure shared logic)
- **Schema & migrations:** `server/migrations/`
- **Specs, plans, reports:** `docs/` (`docs/tickets/` for tickets, `docs/Uber-Ride-Tracker-PRD.md`, `docs/BACKUP-FORMAT.md`, `docs/FINAL-ACCEPTANCE.md`)
- **Agent state & execution cache:** `.context/` — **gitignored**, regenerable, never committed
- **Tool-specific AI configuration:**
  - Google Antigravity / Gemini CLI / Command Code: `.agents/` (read directly), `GEMINI.md`
  - Claude Code: `.claude/`, `CLAUDE.md`
  - Cursor: `.cursor/rules/`, `.cursorrules`
  - Windsurf: `.windsurf/`, `.windsurfrules`
  - Cline / Roo Code: `.roo/`, `.clinerules`, `.roomodes`
  - GitHub Copilot: `.github/copilot-instructions.md`
  - Kilo Code: `.kilo/`
  - OpenCode: `.opencode/`
  - ZCode / GLM (z.ai): `.zcode/`
- **Single source of truth:** `.agents/agent/`, `.agents/rules/`, `.agents/skills/`, `.agents/workflows/`. Everything else is a symlink into those four directories — **edit `.agents/`, never the symlink targets.**
  - Agents: `.agents/agent/*.md` → `.claude/agents`, `.kilo/agent`, `.opencode/agents`. Frontmatter must be OpenCode-compatible: use a `permission:` mapping, never a scalar or sequence such as `tools: Read, Write, Edit`. OpenCode aborts on invalid frontmatter, which silently breaks its ACP server in Zed. Enforced by `tests/agent-config.test.ts`.
  - Skills: `.agents/skills/*/SKILL.md` (Agent Skills standard) → `.claude/skills`, `.kilo/skills`, `.opencode/skills`, `.zcode/skills`. Command Code and Antigravity/Gemini read `.agents/skills/` directly.
  - Workflows (slash commands): `.agents/workflows/*.md` → `.claude/commands`, `.kilo/command`, `.opencode/commands`.

---

## Subagent Specializations

1. **`analyst`** — read-only investigator. Reads files, inspects `server/migrations/*.sql`, runs safe inspection commands, produces curated digests. Never modifies anything, never opens the real data directory.
2. **`backend-coder`** — server implementation: routes, `node:sqlite` store, migrations, shared domain logic, `node:test` suites.
3. **`frontend-coder`** — React 19 + Vite + plain CSS panels, client state, accessibility wiring, Playwright specs.
4. **`committer`** — stages explicitly specified paths and commits in this repo's plain-sentence style. Never pushes, merges, rebases, or amends.
5. **`product-manager`** — turns a rough issue list into complete deliverables, asking clarification questions in file batches. Never uses an interactive question tool for clarification.

Subagents cannot nest, so orchestration runs in the main context.

---

## Commands & Workflows

- `/dev-cycle`: Full cycle — PM clarification → tickets → approval → per-ticket build → verify → fix loop.
- `/handle-ticket <path>`: One ticket start-to-finish.
- `/orchestrator <tasks>`: Coordinates a task set across coder subagents, committing per task.
- `/create-implementation-plan <ticket>`: Architecture and implementation plan.
- `/breakdown-plan-into-tasks <plan>`: Dependency-ordered parallel task batches.
- `/convert-to-tickets`: Backlog or PM deliverables → `docs/tickets/A<nn>-*.md`.
- `/verify-deliverable <ticket>`: Per-AC verdict report against acceptance criteria.
- `/verify-and-ship`: Run the checks, fix failures, stage explicitly, commit.
- `/pr-review [source] [target]`: Full branch review against the invariants and conventions.
- `/product-management`: PM clarification cycles producing deliverables under `.context/pm-cycles/`.
- `/debug <issue>`: Reproduce with a failing test → root cause → minimal fix.
- `/investigate <question>`: Read-only codebase research.
- `/google <query>`: Web search.
- `/implementation <task>`: Ad-hoc implementation.
- `/markdown-writer <file>`: Markdown writing with deterministic validation.
- `/kilo-config`: Kilo configuration help.