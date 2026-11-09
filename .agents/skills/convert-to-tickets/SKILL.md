---
name: convert-to-tickets
description: Convert a TODO backlog, a set of acceptance criteria, or PM deliverables into ticket files under docs/tickets/. backlog mode takes each entry with Goal/Scope/Done-when carried verbatim (Source A<nn>); deliverables mode reads a deliverables index (or deliverable files), assigns sequential A ids, and carries the requirements body verbatim. Use after editing docs/TODO.md, after a product-management cycle completes, or when user asks to turn either into tickets.
---

# Convert to Tickets Skill

Turn each backlog entry into a ticket file `docs/tickets/A<nn>-<slug>.md`. Ticket = requirements carrier (problem/goal, acceptance criteria, scope, constraints, dependencies) + traceability to the source entry. **No solution spec** — the implementation plan derives the solution later.

## Inputs

One of:

1. **Backlog path** — `docs/TODO.md`, or the acceptance-criteria table in `docs/Uber-Ride-Tracker-PRD.md` §11 / `docs/FINAL-ACCEPTANCE.md` (create a backlog file if absent) → one ticket per entry (`A01`, `A02`, …)
2. **Deliverables index path** — e.g. `.context/pm-cycles/pm-cycle-.../deliverables.md` → convert every deliverable listed
3. **Deliverable file path(s)** — e.g. `.context/pm-cycles/.../deliverables/DEL-01-duplicate-detection.md` → convert only these
4. No input → ask. Do not guess.

## Ticket ID allocation

This project numbers acceptance criteria `A01`–`A22` (`docs/FINAL-ACCEPTANCE.md` is the traceability record). New tickets **continue that sequence** — ids are never reused or renumbered.

- **Backlog mode:** id = the backlog entry number, verbatim (`A01`, `A02`, …). No counter, no renumbering — ids must match the source exactly, because `docs/FINAL-ACCEPTANCE.md` and `tests/*.test.ts` titles reference them.
- **Deliverables mode:** sequential `A<nn>`, counter persisted at `docs/tickets/.next-id` (plain number, next id to use).
  - File missing → scan `docs/tickets/A*.md`, use `max(existing numeric suffix) + 1`. If none exist, start at 23 (the project is at `A22`).
  - Allocate ids in deliverable order from the index (DEL-01 → lowest new id, etc.).
  - After writing all tickets, update `.next-id` to the next unused id.

## Execution

1. **Read the input** fully.
   - Backlog mode — for each entry capture: `A<nn>`, title, Goal, Scope, Done when, Depends on.
   - Deliverables mode — for each deliverable capture: DEL id, title, type (feature/bugfix/enhancement), problem, acceptance criteria, constraints, dependencies, source-issue references.
2. **Read existing tickets** in `docs/tickets/` to skip entries already converted (a ticket whose traceability block references the same source — the same `A<nn>` from the backlog, or the same DEL id in the same cycle → skip, note it).
3. **For each entry, write** `docs/tickets/A<nn>-<slug>.md`:

```markdown
# A<nn> · <feature|bugfix|enhancement> · <Title>

> **Source:** A<nn> (docs/TODO.md) | <path-to-deliverable-file> (DEL-xx, pm-cycle-<ts>)
> **Type:** feature | bugfix | enhancement

## Problem

<Backlog mode: Goal, verbatim. Deliverables mode: from deliverable, verbatim or lightly compressed — the WHAT and WHY, user-visible.>

## Acceptance criteria

- [ ] <Backlog mode: "Done when", verbatim. Deliverables mode: from deliverable, verbatim.>

## Scope

<Backlog mode: Scope bullets, verbatim. Omit entirely in deliverables mode.>

## Constraints

<From deliverable: domain restrictions (integer paisa, blank means unknown, reviewed-only income, local dates with no carry-forward), stack constraints (Node 24, node:sqlite, React 19 + Vite 8, no new runtime dependencies, offline-first), security rules (loopback guards, content-type/decode agreement, upload and archive limits), performance bounds. Omit section if none.>

## Dependencies

<Backlog mode: "Depends on" ids (e.g. A03). Deliverables mode: DEL/ticket ids. "None" if foundational.>

## Notes for planning

<One short paragraph max: pointers the planner may need (related files, prior art like `parseDecimal`/`calculate`/`reviewErrors`, relevant `.context/cache/decisions.md` entries). NOT a solution.>
```

4. **Update `.next-id`** (deliverables mode only).
5. **Create per-ticket working folders** (see `.agents/rules/context-cache.md`): `.context/tickets/A<nn>/` with `ticket.md` = copy of the ticket file. Working state lives under `.context` (gitignored); `docs/tickets/` holds the durable record.
6. **Report**: table of `A<nn>` → source (backlog id or DEL id) → title → path, plus skipped (already converted) entries.

## Rules

- **Requirements only.** If a deliverable contains a solution section (schema, routes, UX flows), do NOT copy it into the ticket. Keep problem + AC + constraints. The planner reads the deliverable itself if it wants that context (source link is in the traceability block).
- **Verbatim AC.** Never rewrite acceptance criteria or "Done when" clauses — they are the contract verify-deliverable checks against.
- **Ids stay in order.** Never renumber entries or reorder tickets away from backlog order — existing ids are referenced by `docs/FINAL-ACCEPTANCE.md` and by test titles.
- **Idempotent.** Re-running must not duplicate tickets — the source traceability check in step 2 is the dedupe key.
- **No git.** Writing files only; no commits (the dev-cycle/handle-ticket flow commits later).