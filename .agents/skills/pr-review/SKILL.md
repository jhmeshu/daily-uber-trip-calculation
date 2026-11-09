---
name: pr-review
description: "Comprehensive PR review covering the Node 24 backend (node:http routes, node:sqlite store, sharp, fflate) + React 19 / Vite 8 plain-CSS frontend of the Uber Ride Tracker: the twelve sacred domain invariants (blank vs zero, integer paisa, reviewed-only income, server authority, parser restraint, local dates), loopback and file-handling security, and node:test + Playwright coverage. Use when user requests to review a pull request or compare branches for code review."
---

# PR Review Skill

When user requests **PR review** or to **compare branches**:

Project context: **Uber Ride Tracker** — a single-user, offline-first, localhost-only web app (Node 24 `node:http` + `node:sqlite`, React 19 + Vite 8, plain CSS, Tesseract OCR, `fflate` backups) that records company-vehicle Uber rides, reconciles monthly income in BDT, and exports a CSV ledger. There is no cloud, no API key, and no external network at runtime — that is a product requirement. The review surface is the money and income invariants, date handling, input validation, the loopback guards, and test coverage.

Spec sources: `docs/Uber-Ride-Tracker-PRD.md`, `docs/PRD-ANALYSIS.md` (§3 holds nine rules that must hold throughout), `docs/IMPLEMENTATION-PLAN.md`, `docs/BACKUP-FORMAT.md`, `docs/FINAL-ACCEPTANCE.md` (the `A01`–`A22` traceability record).

### Branch Defaults

- **Source branch**: current local branch, via `git branch --show-current`.
- **Target branch**: `main`, unless the user explicitly names another.
- If the user names both branches, use those values.

### Pre-Review: Branch Synchronisation

**Do not reset anything.** This repository's doctrine forbids `git reset --hard` outside an explicitly authorized situation, and a review is not one. Instead:

```bash
git fetch --all
git log target..source --oneline
git diff --stat target...source
```

- If `git fetch` fails (offline), continue against local state and say so in the report.
- If the working tree is dirty, **stop and surface it** — a dirty tree makes a diff unreliable and it is not yours to clean.
- Never rebase, merge, or reset as part of a review. If the branches cannot be compared cleanly, report that and ask.

**Offline mode**: if the user says "offline", skip the fetch entirely and review local state only.

### Parallel Subagent Strategy

Review accelerates using **up to 3 parallel `analyst` subagents**:

| Subagent | Scope | Focus |
|----------|-------|-------|
| 1 | Diff analysis + architecture | layering (`server/` route → validation → `src/shared/` → store), conventions, shared-logic duplication |
| 2 | Server-specific | money/paisa correctness, `calculate()` status transitions, validation and error mapping, migration discipline, backup table coverage |
| 3 | Frontend + tests | state and async guards, accessibility labels the specs depend on, `node:test` and Playwright coverage |

**When to parallelise:** always when the diff touches more than a few files. For a 1–2 file cosmetic diff, a single pass is fine.

Launch all independent subagents in a single message, each with the diff and its scope, then synthesize.

## 1. Run the Complete Diff

Analyze **actual code changes**, not commit messages.

```bash
git diff target...source
git log target..source --oneline
```

## 2. Identify Change Types

For each change: feature addition (cite the `A<nn>` or `M<n>` id it serves), bug fix, refactor, cleanup, or a **potential breaking change** (schema migration, API payload change, settings-semantics change, backup-format change).

Note missing tests, incomplete docs, and inconsistencies with the PRD.

## 3. Assess Code Quality & Impact

- **Correctness**: does it do what it claims?
- **Readability**: will the dense house style stay readable, or did the change introduce inconsistency?
- **Maintainability**: can this be modified later without archaeology?
- **Architectural alignment**: does it follow route → validation → `src/shared/` → store, with pure logic pure and no SQL inside shared helpers?
- **Money handling**: integer paisa with `BigInt` accumulation everywhere? Any floating-point sum of paisa?
- **Date handling**: local calendar dates via the existing helpers, no inferred years, no carry-forward?
- **Safety**: could a bug silently corrupt income, double-count a trip, count a draft or trashed ride, or coerce an unknown to zero?

Check whether tests adequately cover the changes.

## 4. Stack-Specific Review Items

### 4a. Server (`server/`, `src/shared/`)

**Layering**
- Routes in `server/app.ts` / `server/intake-routes.ts` stay thin: parse, validate, call shared domain or store, shape the response. No business logic inlined in a handler.
- Pure calculations live in `src/shared/` with no `node:*` imports and no database I/O.
- `src/shared/` is imported by the browser too — a `Buffer`, `fs`, or `sharp` reference there breaks the Vite build.

**Persistence & schema**
- A migration is **two** edits: the new `server/migrations/0NN-*.sql` **and** its filename appended to the array in `server/store.ts`. Half a migration is a startup failure.
- No released migration was edited; no number reused below the highest shipped file.
- `BACKUP_TABLES` in `server/backup.ts` updated if a table was added, renamed, or dropped — and `docs/BACKUP-FORMAT.md` re-checked. A table silently missing from backups is data loss.
- Multi-step writes wrapped in `store.transaction(...)`.
- `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL` not weakened.
- Bound parameters everywhere; no string-interpolated SQL.

**Money & domain invariants (sacred)**
- Blank stayed `null` end to end — no `Number(x) || 0`, no `?? 0`, no prefill.
- Income formula exactly `cash + credit - commission - pass`, then `- tips`. No second aggregation path; `summarize()` is the only one that decides reviewed-only totals.
- `calculate()`'s `unresolved` / `incomplete` / `complete` states not collapsed.
- Any change to a `financialFields` member resets `financial_confirmed`, detected via `financialSignature()`.
- `PARSER_VERSION` bumped if parser behaviour changed; no invented values on an unrecognized layout; no silent pick between conflicting observations; no year inferred from map text.

**Validation & errors**
- Every mutation body checked with `exact()`; every path id through `requireId()`.
- `PUT` carries `revision`; mismatch is a `ConflictError`. Destructive routes require `confirmed: true`.
- Status mapping centralised: `ValidationError` → 400, `ConflictError` → 409, `ENOENT` → 404, else a fixed 500 message.
- No path, SQL text, or driver message interpolated into a response.

**Security**
- Host validation, Origin validation, `Sec-Fetch-Site`, CSP, `nosniff`, `no-store`, and path containment all intact and not weakened.
- Declared MIME matches `sharp`-decoded format.
- Upload, JSON body, and archive caps enforced before buffering, not raised to make a test pass.
- Archive entry paths reject absolute paths, `..`, and symlinks.
- Files `0o600` in `0o700` directories, `flag: 'wx'`, `.tmp` + `renameSync`, generated `${uuid}.${ext}` keys.
- No external network at runtime — no CDN URL, no remote font, no fetch to a third party.
- No swallowed exceptions (an empty `catch {}` needs a comment justifying it).

### 4b. Frontend (`src/*.tsx`, `src/style.css`)

**State & data flow**
- All HTTP through `api<T>()`; no direct `fetch`.
- `alive` unmount guards and sequence-number async guards preserved.
- Autosave still debounced and serialized through the promise-chain ref — two overlapping saves corrupt a session.
- No `setState` after unmount; no stale response overwriting a newer one.

**Money & unknowns**
- Money rendered only via `money()`, durations only via `formatDuration()`. No hand-formatted paisa in JSX.
- Blank inputs still render as blank and as visually distinct from a real `0`.
- Client totals labelled as previews.

**Accessibility (the browser suite depends on it)**
- Every new control has a `label` or `aria-label`; `tests/*.spec.ts` selects only by role and accessible name.
- Errors use `role="alert"`, status uses `role="status"`.
- Keyboard reachable with a visible `:focus-visible` outline; no overflow at 390px.

**Conventions**
- Named exports only, inline prop types, `.ts`/`.tsx` import extensions, `as const` unions over `enum`.
- No new component library, state library, or CSS framework — the dependency list is closed on purpose.
- Dense house style preserved; no unrelated reformatting smuggled into the diff.

## 5. Test Coverage

- `node:test` cases for new/changed routes and domain functions: happy path, invalid input → 400, revision conflict → 409, boundary money cases.
- Pure `src/shared/` changes extend `tests/*.test.ts`; UI flows extend `tests/*.spec.ts`.
- Boundary coverage where it matters: blank vs explicit zero, `null` propagation through `calculate`, `MAX_SAFE_INTEGER` paisa overflow, image size and megapixel limits, restore generation switch.
- Every `Store` in a test uses a `mkdtempSync` root — no test can touch the real data directory.
- `npm test` green; `npm run typecheck` clean; `npm run build` clean when `src/` or `server/` changed; `npm run test:e2e` run for user-facing flows.

## 6. Provide a Senior-Level Review Summary

Direct, actionable feedback: call out risks, highlight strengths, suggest improvements, and state plainly whether the change is ready to merge or needs revision.

## 7. Aim for Practical, High-Value Feedback

Emulate real review from an experienced engineer — clear, specific, focused on what matters. Do not pad with style nits on a codebase whose dense style is intentional.

## 8. Write the Review Report

Write a markdown report into `./docs/` (e.g. `docs/REVIEW-<branch>-<date>.md`). Contents: summary of changes; code quality assessment; domain-invariant conformance against the `A<nn>` criteria; security and data-safety implications; testing coverage; recommendations; ready-to-merge verdict.

---

## Review Checklist

### Architecture & Design
- [ ] Layering respected: route → validation → `src/shared/` → store
- [ ] Pure helpers stay pure; no `node:*` import inside `src/shared/`
- [ ] No money or date logic duplicated between `src/shared/` and a component
- [ ] Panels in `src/*.tsx` keep single responsibility

### Server
- [ ] `exact()` on every mutation body; `requireId()` on every path id
- [ ] Status mapping centralised; no leaked paths, SQL, or driver text
- [ ] Multi-step writes inside `store.transaction(...)`
- [ ] Migration is two edits; released migrations untouched; `BACKUP_TABLES` in sync
- [ ] Blank stayed `null`; no `|| 0`, no `?? 0`, no zero prefill
- [ ] Integer paisa, `BigInt` accumulation, reviewed-only income, server-authoritative totals
- [ ] `financial_confirmed` invalidated on any financial edit
- [ ] Parser invents nothing; `PARSER_VERSION` bumped on behaviour change
- [ ] No secrets logged; no swallowed exceptions

### Frontend
- [ ] All HTTP through `api()`; unmount and sequence guards intact
- [ ] Money via `money()`, durations via `formatDuration()`, blanks visibly unknown
- [ ] Every control labelled; `role="alert"` / `role="status"` used correctly
- [ ] No new styling, component, or state dependency
- [ ] Dense house style preserved; no unrelated reformatting
- [ ] No horizontal overflow at 390px

### Security
- [ ] Loopback guards, CSP, `nosniff`, `no-store`, path containment intact
- [ ] Declared MIME matches decoded image format
- [ ] Body / upload / archive caps enforced before buffering
- [ ] Archive entries reject traversal and symlinks
- [ ] Files `0o600` in `0o700` dirs, atomic `.tmp` + rename
- [ ] No external network at runtime; OCR assets served locally
- [ ] No `dangerouslySetInnerHTML`; CSV formula-injection prefix preserved

### Testing
- [ ] `node:test` covers new routes and domain functions
- [ ] Playwright covers changed user flows, selecting by role and label
- [ ] Temp data roots everywhere; never the real data directory
- [ ] `npm test` and `npm run typecheck` green; `npm run test:e2e` run where warranted

### Code Quality
- [ ] camelCase helpers, PascalCase components, SCREAMING_SNAKE constants
- [ ] Named exports, inline prop types, explicit import extensions
- [ ] Comments explain non-obvious invariants, not the next line
- [ ] Commit messages are single plain sentences matching `git log` style, explicit paths staged