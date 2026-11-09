---
name: breakdown-plan-into-tasks
description: Break a large implementation plan into small, parallelizable tasks for the backend-coder and frontend-coder agents. Use when user requests to break down a plan into tasks.
---

# Task Breakdown Skill

Read the provided plan file. Then follow the two-phase process below to produce a structured task breakdown.

## Phase 1: Codebase Analysis

Before breaking down tasks, **analyze the codebase** to build accurate understanding and fill knowledge gaps the plan may leave implicit. Prevents tasks referencing nonexistent files, wrong abstractions, or outdated patterns. Specifically:

- **Verify every file path and module** the plan mentions — confirm they exist, or note they need creation (`server/`, `src/shared/`, `src/*.tsx`, `server/migrations/*.sql`)
- **Map current architecture** — understand existing patterns, conventions, and interfaces the plan builds on; verify the live schema from `server/migrations/*.sql` (tables, `STRICT` mode, `CHECK` constraints) and the routes in `server/app.ts`
- **Check for prior art** — search for existing implementations that partially cover what the plan describes (partial refactor, abandoned branch, a helper already written like `parseDecimal`, `calculate`, `reviewErrors`, `financialSignature`, `matches`, `summarize`, `requireId`, `cleanLocation`)

Use up to **3 parallel `analyst` subagents** to speed up this phase and keep the main context window clean. Example split:

| Subagent | Responsibility |
|----------|---------------|
| Subagent 1 | Verify file/module existence, map directory structure, check build/config files (`package.json`, `tsconfig.json`, `playwright.config.ts`) |
| Subagent 2 | Trace data flow and interfaces the plan references (`src/shared/domain.ts`, route contracts) — read relevant source files |
| Subagent 3 | Search for prior art, existing utilities, and hidden coupling across the codebase |

Each subagent should return a concise summary of findings. Use those summaries — not raw exploration — to inform the breakdown.

## Phase 2: Task Breakdown

Using the plan plus codebase analysis, break the work into small, self-contained tasks that `backend-coder` and `frontend-coder` agents can execute independently.

Assign each task to the appropriate layer:

- **Backend:** `server/` routes, `node:sqlite` store and migrations, intake/OCR plumbing, backup-restore, shared domain math in `src/shared/`, `node:test` unit and API tests
- **Frontend:** React panels in `src/*.tsx`, plain CSS in `src/style.css`, client state in `src/main.tsx`, accessibility labels the Playwright suite depends on, `tests/*.spec.ts` coverage

Continue using up to **3 parallel `analyst` subagents** during this phase to draft batches of tasks concurrently. Example:

| Subagent | Responsibility |
|----------|---------------|
| Subagent 1 | Draft Batch 1 tasks (no dependencies) |
| Subagent 2 | Draft Batch 2 tasks (depends on Batch 1) |
| Subagent 3 | Draft Batch 3+ tasks and the visual dependency diagram |

Merge subagent outputs into the final document, resolving conflicts or gaps.

## Output

Write results in a new file alongside the plan, named `{plan-filename}-tasks.md` (e.g. `docs/tickets/A23-duplicate-trip-detection-plan.md` → `docs/tickets/A23-duplicate-trip-detection-plan-tasks.md`).

## Task Format

Each task must include:

- **ID & Title** — e.g. `Task 1: Add duplicate check to the ride review route`; concise, action-oriented
- **Assigned Agent** — `backend-coder` or `frontend-coder`
- **Description** — detailed enough for an agent unfamiliar with the plan to execute. Include exact file paths (`server/app.ts`), functions to implement, source references (file paths, line numbers, function names), and relevant context
- **Acceptance Criteria** — specific, verifiable checklist items
- **Subtasks** — only if the task is complex enough to warrant
- **Dependencies** — exact task IDs this depends on, or "None"

## Parallelization Strategy

Include a batch-based execution model at the top of the document:

1. **Organize tasks into batches** by dependency order — all tasks within a batch can run in parallel with zero merge conflicts
2. **Include a visual batch diagram** showing dependency flow
3. **State merge order rules** — which batches must merge before others can start
4. **Provide a summary table** — columns: `#`, Batch, Target File, Assigned Agent, Dependencies, Can Parallel With

Typical batching for this codebase:

- **Batch 1 (Foundational):** shared domain math in `src/shared/`, and any `server/migrations/0NN-*.sql` plus its registration in `server/store.ts`
- **Batch 2 (Server & Core):** routes in `server/app.ts` / `server/intake-routes.ts`, validation, intake and OCR plumbing, `node:test` API coverage
- **Batch 3 (Frontend):** React panels, `src/style.css` classes, client state and autosave, `role`/`aria-label` wiring, `tests/*.spec.ts` coverage
- **Batch 4 (Verification & Polish):** Playwright flow coverage, edge-case tests, CSV export and backup/restore round trips

## Key Principles

- **One task = only a few files (tightly coupled set)** — minimize merge conflict surface
- **Dependencies are explicit** — every dependency listed by task ID
- **Layer-correct** — backend tasks never invent UI, frontend tasks never embed SQL or bypass `src/shared/` domain helpers
- **A migration is never its own task** — the new `.sql` file and its registration in `server/store.ts` belong to the same task, and if a table is added or renamed so is the `BACKUP_TABLES` entry in `server/backup.ts`