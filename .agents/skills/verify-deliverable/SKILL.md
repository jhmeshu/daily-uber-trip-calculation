---
name: verify-deliverable
description: Verify an implementation against the DELIVERABLE/ticket acceptance criteria (what we want), not just the plan. Checks both links — deliverable→implementation (intent conformance) and plan→implementation (plan conformance) — plus builds/tests. Writes a per-AC verdict report. Use after a ticket is implemented, at the end of handle-ticket or dev-cycle build phase, or when user asks to verify a ticket against requirements.
---

# Verify Deliverable Skill

Chain of truth:

```
ticket/deliverable (WHAT we want) → plan (HOW) → implementation (DID)
```

Verifying only against the plan can pass while missing intent — the plan itself may have drifted from the deliverable. This skill checks **both** links.

## Inputs

- **Ticket file** (required): `docs/tickets/A<nn>-<slug>.md` or `.context/tickets/A<nn>/ticket.md` — the acceptance-criteria source of truth
- **Plan file** (required): the `*-plan.md` written by create-implementation-plan
- **Tasks file** (optional but usual): the `*-tasks.md` breakdown
- **Base branch** (default `main`) for the diff

If any required input is missing, ask. Do not guess paths.

## Execution

### Step 1 — Gather evidence (cheap first)

1. Read ticket, plan, tasks files fully.
2. Freshness-check any `.context/tickets/A<nn>/findings/` files (see `.agents/rules/context-cache.md`) — reuse fresh ones, refresh stale sections only.
3. Diff: `git diff --name-only <base>...HEAD` → changed-file list. Full diff for the files the plan names.
4. Run tests by default:
   ```bash
   npm run typecheck   # tsc --noEmit
   npm test            # tsx --test tests/*.test.ts
   npm run build       # setup:ocr + tsc --noEmit + vite build — only if src/ or server/ changed
   npm run test:e2e    # Playwright — only when a user-facing flow changed; runs real OCR, takes minutes
   ```
   Tolerant of missing scripts: if a script isn't defined in `package.json`, report `script not defined, skipped` and move on — a missing script is not a failure. If a suite is skipped for time, say so explicitly; never report it as passed. Only skip the whole step if the user pre-declared no local toolchain — then say "static review only".

### Step 2 — Intent conformance (deliverable → implementation)

For **each acceptance criterion** in the ticket, verdict:

| Verdict | Meaning |
|---|---|
| ✅ satisfied | AC demonstrably met (code + tests as evidence) |
| ⚠️ partial | Some evidence, incomplete |
| ❌ missing | Not implemented or not demonstrable |
| ❓ unverifiable | Needs runtime/manual check (e.g. OCR recognition against a real driver screenshot that only the owner has — supply it through `UBER_OCR_SAMPLE`, never commit it; a full backup/restore round trip against the owner's real data directory, which must never be reset; a real CSV round trip through a spreadsheet app) — state exactly what to check manually |

Evidence = diff hunks, test names/results — cite `file:line`. Use up to 2 parallel analyst subagents (server / frontend) if the diff is large; otherwise read directly.

### Step 3 — Plan conformance (plan → implementation)

For each planned file/behavior: implemented as planned / deviates (note how) / dropped. Deviations are NOT automatically failures — coders legitimately discover better approaches — but every deviation is listed.

### Step 4 — Divergence report (deliverable vs plan)

Compare AC against plan scope. Where the plan omitted or weakened an AC, flag:

> Plan gap: AC A21 (restore keeps the prior generation recoverable) is not covered by any task. Implementation may match the plan perfectly yet miss it.

This is the step plain plan-verification cannot do. Divergences are surfaced for the user, not auto-judged.

### Step 5 — Write report

`.context/tickets/A<nn>/findings/verify-YYYY-MM-DD.md`:

```markdown
# Verification — A<nn>

based-on: <HEAD sha>, date, base branch
Tests: typecheck <pass/fail>, npm test <pass/fail + failing names>, build <pass/fail/not-run>, e2e <pass/fail/not-run>

## Verdict: accepted | gaps-found

## Acceptance criteria
| # | AC (short) | Verdict | Evidence |
|---|------------|---------|----------|

## Invariants checked
| Invariant | Held? | Evidence |
|-----------|-------|----------|

## Plan conformance
| Planned item | Status | Deviation |
|--------------|--------|-----------|

## Deliverable vs plan divergences
- <or "none">

## Gaps requiring action
- <AC #, what's missing, suggested targeted fix>
```

Also copy/append summary line to `.context/tickets/A<nn>/report.md`.

### Step 6 — Maintain the map

You diffed everything — update `.context/cache/codebase-map.md` sections covering changed files (rewrite from what you just read). Append any settled decisions to `.context/cache/decisions.md`.

## Verdict rules

- **accepted** — all AC ✅ (❓ unverifiable ACs allowed if the manual check is stated), tests green.
- **gaps-found** — any ⚠️/❌, or failing tests. List targeted fixes; do NOT auto-fix (dev-cycle's fix loop or the user dispatches those).

## Rules

- Never claim a test passed that wasn't run.
- ❓ is honest — OCR against the owner's real screenshot, or a restore against the real data directory, cannot be fully verified statically. Say what the user must check by hand.
- Read findings before re-analyzing (decide-then-read, see context-cache rules).
