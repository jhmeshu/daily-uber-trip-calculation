---
name: create-implementation-plan
description: Read a ticket file (bug, feature, or enhancement), analyze the codebase, and write a comprehensive implementation plan covering server routes, shared domain logic, SQL migrations, React components, and node:test / Playwright coverage. Use when the user hands you a ticket file path and wants an implementation plan generated.
---

# Create Implementation Plan Skill

Read the provided ticket carefully, understand what needs to be delivered, analyze the codebase, then write a complete and comprehensive implementation plan as a new markdown file in the **same folder** as the ticket.

The ticket may be a **bug**, **feature**, or **enhancement** — adapt the analysis focus and plan shape to the ticket type.

## Inputs

User provides a **ticket file path**, e.g.:

- `docs/tickets/A23-duplicate-trip-detection.md`
- `docs/tickets/A25-monthly-summary-timezone.md`
- Absolute or relative path to a single `*.md` ticket

If no input is provided, **ask** for the ticket file path. Do not guess.

## Execution Steps

Follow exactly, in order.

### Step 1: Read & understand the ticket

Resolve the input to an absolute path and read it **completely**. Extract and hold in context:

- **Ticket ID** (e.g. `A23`) — derive from the filename or the ticket heading
- **Ticket type** — bug / feature / enhancement. Infer from content: repro steps + expected/actual → **bug**; a new capability → **feature**; a modification/tweak to something existing → **enhancement**. State the assumption explicitly.
- **What needs to be delivered** — the requirement or defect, in your own words
- **Named API routes, shared domain functions, React panels**
- For bugs: the **steps to reproduce** + expected vs. actual result

State your understanding back before analyzing: "Read ticket A23 (bug) — <one-line summary>. Analyzing codebase..." (swap the type and summary as appropriate).

### Step 2: Analyze the codebase

Use up to **3 parallel `analyst` subagents** to investigate and keep the main context window clean. **The split adapts to the ticket type.**

**For a bug** — focus on the defect:

| Subagent | Responsibility |
|----------|---------------|
| **Repro path** | Trace the reproduction path end-to-end. Locate the routes / panels / shared helpers named in the ticket, read the exact code path, and confirm where the buggy behavior occurs. Cite `path:line`. |
| **Root cause** | Pinpoint the defect — the missing guard / wrong money rounding / bad assumption, *why* it allows the bad behavior, and where the correct check belongs (UI → validation → shared domain → store). |
| **Prior art & fix surface** | Map patterns to reuse: similar existing guards, `parseDecimal` / `calculate` / `validateInput` usage, test fixtures, and any frontend impact. |

**For a feature / enhancement** — focus on the design surface:

| Subagent | Responsibility |
|----------|---------------|
| **Integration points** | Where the new/changed capability plugs in: relevant handlers in `server/app.ts` and `server/intake-routes.ts`, the migration it extends in `server/migrations/`, and any new API contract. Cite `path:line`. |
| **Patterns & conventions** | Existing precedents to mirror: `parseDecimal`, `calculate`, `reviewErrors`, `financialSignature`, `matches`, `summarize`, `requireId`, the `exact()` helper, and the `ValidationError` / `ConflictError` mapping style. |
| **Cross-cutting & frontend** | The twelve sacred invariants from `.agents/rules/backend-development-rules.md` (blank ≠ zero, integer paisa with `BigInt` intermediates, reviewed-only income, server authority, financial-edit invalidation, the income formula, parser never invents, local dates with no carry-forward, exact key sets and optimistic concurrency, two-edit migrations, transactional multi-step writes, storage lifecycle) plus frontend impact (`src/main.tsx` state ownership, autosave serialization, `role`/`label` accessibility that `tests/*.spec.ts` depends on). |

App structure: HTTP routes in `server/app.ts` and `server/intake-routes.ts` (per-route, explicit validation, mapped error statuses), pure domain math in `src/shared/domain.ts` (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`) imported by **both** sides, UI in `src/*.tsx`, schema in `server/migrations/*.sql` applied via `PRAGMA user_version`. Tests live in `tests/` — `node:test` for unit/integration/API, Playwright for browser flows.

Each subagent returns a **curated digest** with `path:line` evidence — not raw file dumps. Work from those digests.

If the ticket is clearly single-layer or small, drop to 1–2 subagents. Add more `analyst` calls only if a digest surfaces a new area worth a focused probe.

### Step 3: Synthesize the approach

Combine the digests into a single coherent picture:

- **Bug** → state the root cause (what + why) and the minimal, convention-correct fix set
- **Feature / enhancement** → state the design: new/changed migration(s), route handlers, shared domain helpers, API contract, UI panels — and a sensible build order (schema → shared domain → route/validation → UI)
- **Both** → list edge cases & risks (blank-vs-zero coercion, paisa rounding and `MAX_SAFE_INTEGER` overflow, `calculate()` status transitions, revision conflicts on concurrent tabs, restore generation flips, image decode limits, related paths needing the same change, regressions, migration ordering) and any open questions

Respect project conventions: every route validates with `exact()` and `requireId()` before touching storage, error mapping is centralised (`ValidationError` → 400, `ConflictError` → 409, `ENOENT` → 404, else a fixed 500), money math stays pure and `BigInt`-exact in `src/shared/`, income is reviewed-only, the loopback guards are never weakened, migrations are two edits, and the UI matches the existing dense plain-CSS house style without introducing a dependency.

### Step 4: Write the implementation plan

Write the plan to the **same directory as the ticket**, named `{ticket-filename}-plan.md` — e.g. ticket `docs/tickets/A23-duplicate-trip-detection.md` → `docs/tickets/A23-duplicate-trip-detection-plan.md`. Use the template below; include the **Root Cause** section **only for bugs**.

## Plan Template

```markdown
# Implementation Plan — {TICKET_ID}

**Ticket:** `{path-to-ticket}`
**Type:** {Bug | Feature | Enhancement}
**Title:** {ticket title}
**Generated:** {ISO date}

---

## Summary

{1–2 paragraph restatement of what needs to be delivered, in your own words.}

## Root Cause  *(bugs only — omit for feature/enhancement)*

{The precise defect: what is wrong and why it happens, with `path:line` evidence.}

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| HTTP route | `server/app.ts` | ... |
| Shared domain | `src/shared/domain.ts` | ... |
| Schema | `server/migrations/00N-*.sql` (+ array in `server/store.ts`) | ... |
| Panel | `src/EvidenceReview.tsx` | ... |
| Test | `tests/evidence.test.ts` | ... |
| ... | ... | ... |

## Proposed Implementation

{Step-by-step. One sub-section per change, each with **File** / **What** / **Why** / **Code reference** (existing helper/component the change builds on). Group server (schema + routes + shared domain) and frontend (React panels) changes separately. For features/enhancements, order changes by build dependency.}

### Server Changes
...

### Frontend Changes
*(only if the ticket or fix touches the UI)*
...

## Invariants At Risk

- {which of the sacred invariants this change could break, and how the design protects them}

## Edge Cases & Risks

- {blank vs zero, paisa rounding, revision conflicts, restore generations, image limits, migration ordering, regressions}

## Testing

*Follow the project's established conventions — `node:test` in `tests/*.test.ts` and Playwright in `tests/*.spec.ts`. One behaviour per test, flat top-level `test()` calls, temp data roots, synthetic fixtures. Titles carry the acceptance id when one exists.*

- **Domain tests:** {pure `src/shared/` cases — inputs in, derived income out, unknown vs zero}
- **API tests:** {route flows: happy path, invalid input 400, revision conflict 409, host/origin rejection}
- **E2E tests:** {Playwright flows through the affected panels, selectors by role and accessible name}

## Acceptance Criteria

- [ ] {verifiable outcome — mirrors the ticket's "Expected Result" / acceptance criteria}
- [ ] ...

## Open Questions  *(optional)*

- {anything needing a product/owner decision}

## Out of Scope

- {anything explicitly not addressed}
```

## Error Handling

- **Can't read ticket** — ask the user to verify the path; do not proceed.
- **Ticket has no ID** — derive a slug from the filename; flag it in the plan.
- **Ticket type unclear** — state your best inference and why; proceed on that basis and note it.
- **Approach ambiguous** (e.g. unclear root cause, or a feature with multiple valid designs) — document the leading approach with evidence, list the alternatives, and mark what needs confirmation. Do not fabricate `path:line` citations.
- **Subagent failure** — retry the failed `analyst` individually; note in the plan if an area could not be fully investigated.

## Key Principles

- **Delegate analysis, write yourself.** Keep the main context clean — investigate via `analyst` subagents, synthesize and write the plan directly.
- **Evidence-backed.** Every code claim cites `path:line`. No guesses presented as fact.
- **Convention-correct.** Respect the layering (route → validation → shared domain → store) and the project's money, income, and security invariants; never propose coercing a blank to zero, floating-point paisa accumulation, accepting a client-supplied total, bypassing the loopback guards, editing a released migration, or adding a runtime dependency.
- **Adapt to the ticket type.** Bugs hunt a root cause; features/enhancements lay out a design. Same plan skeleton, type-appropriate emphasis.
- **Comprehensive but minimal.** Cover the full surface (including related paths needing the same change) without scope creep. Out-of-scope items are called out explicitly.