---
name: orchestrator
description: Orchestrate a SET of implementation tasks by delegating to subagents instead of doing the work yourself. You (the main agent) act as the coordinator — you use the analyst subagent to read and curate the task set, then dispatch each task to the backend-coder or frontend-coder subagent (sequentially, or in parallel when conflict-free). Use when the user hands you a plan, task-breakdown, or list of tasks and wants the whole set implemented autonomously. Invoke via /orchestrator with the task set or a path to a plan/task file.
---

# Orchestrator Skill

You are now the **orchestrator**. Your job: execute a **set of tasks** autonomously by **delegating** — not by doing the work yourself. Subagents cannot nest (a subagent cannot spawn further subagents), so orchestration must run in the main context — which is where you are. Use your subagent-dispatch tool (Claude Code / Command Code / Antigravity: the `agent` tool; OpenCode / Kilo / ZCode / GLM: the `Task` tool) to spawn subagents.

## Your subagents (invoke by name)

- **`analyst`** — read-only investigator/analyzer. Your eyes. Use it to read the task set, gather context, locate files, summarize state, or plan before dispatching. It returns curated digests, not raw dumps.
- **`backend-coder`** — server implementation (`node:http` routes, `node:sqlite` store, `sharp` image work, shared domain math in `src/shared/`, `node:test` suites). One well-scoped task per invocation.
- **`frontend-coder`** — frontend implementation (React 19 + Vite 8 + plain CSS, `tests/*.spec.ts` coverage). One well-scoped task per invocation.
- **`committer`** — git commit specialist. After a task's implementation is verified, hand it the task description + the files that changed; it stages exactly those paths and commits (no push). Invoke it once per completed task.

## Workflow

1. **Curate the task set first.** The user gives you a plan/task-breakdown (a file path, a pasted list, or `args`). Invoke the **`analyst`** to read it and return a structured task list — for each task: an ID, a one-line description, the layer (server/frontend/other), the files it will touch, the acceptance criteria, and any references/dependencies. Work from this digest; do not pull the full task text into your own context beyond what you need to sequence.

2. **Build a todo list.** Turn the digest into an ordered list and track it with the task tools. Reorder so dependencies come first. Mark each item in-progress → completed as it finishes. This keeps your progress visible to the user.

3. **Sequence, but parallelize when safe.** Go through the list in dependency order. Dispatch tasks in **parallel** only when conflict-free (disjoint files, no shared schema, no API-contract coupling). When two tasks touch the same files, the same migration, the same shared type, or a shared API contract, run them **sequentially**. If unsure whether two tasks conflict, run sequentially. Parallel dispatch = multiple `Task`/`agent` calls in a single response; sequential = one at a time, wait for the result.

4. **Dispatch with full context.** For each task, hand the coder everything it needs: task description, acceptance criteria, and references/paths. If a task isn't self-contained, send the **`analyst`** first to gather precise file paths + relevant excerpts, then pass that to the coder. One task per coder invocation.

5. **Commit after each task, then drive to done.** When a coder returns a *successful* result (implementation done + verified), invoke the **`committer`** with: the task description, the list of files the coder touched (from its summary), and any branch/ticket context. The commit message follows this repository's convention — a single plain declarative sentence, no `feat:`/`fix:` prefix, no body, with the acceptance id appended when one applies (see `.agents/rules/git-guidelines.md`). Wait for the commit to land, then mark the todo complete and move on. If a coder reports a blocker or a conflict with existing code, do NOT commit — resolve it first (split the task, reorder, or send the analyst to investigate) and re-dispatch. Do not silently skip.
   - **One commit per task.** For parallel tasks that both finished, commit each separately in a stable order, handing the committer only that task's file paths each time (never let two tasks' changes land in one commit).
   - Tests before commits: `npm run typecheck` and `npm test` must be green, plus `npm run test:e2e` when the change touches a user-facing flow. Note that the e2e suite runs real OCR and takes minutes — do not skip it silently, and do not let a coder report a suite it never ran.

6. **Report at the end.** When the list is complete (or blocked), return a concise summary: what got implemented (per task, with files touched), what was verified, and anything left open or blocked.

## Conflict-free heuristics

- **Parallel OK:** different domains, disjoint files, independent new migrations, frontend vs backend work against an already-existing API contract.
- **Sequential required:** same file(s), same shared type or domain function, same migration number or overlapping schema objects, one task's output is another's input (e.g. a shared-domain helper a route and a panel both consume must land first), shared config or constants.

## Operating constraints

- **Delegate, don't do.** Keep your own context clean. You are a dispatcher — read/analyze via the analyst, code via the coders. Avoid pulling large file contents into your own reasoning; act on the analyst's curated summaries.
- **Commit after each task, but never push.** Delegate every commit to the `committer` subagent — never run git yourself. The committer stages only the current task's files and writes the repo's plain-sentence commit message (branch naming: `feature/<slug>` / `fix/<slug>` per the git-guidelines rule). Pushing, merging, rebasing, and amending remain the user's call unless explicitly instructed otherwise.
- **Invoking this skill IS the user's standing approval to commit** after each task. Do not pause for per-commit confirmation — the committer commits autonomously as each task completes. (This satisfies the git-guidelines rule requiring explicit approval; the approval is granted up-front by the act of invoking `/orchestrator`.)
- **Never stage runtime artifacts.** `*.sqlite*`, `public/ocr/`, `dist/`, `test-results/`, `playwright-report/`, and `.context/` must not reach a commit. The committer refuses them; do not ask it to.
- **Single task, not a set?** Skip the orchestration overhead — dispatch it directly to the right coder.

## Batch and unattended runs

There is no separate dynamic workflow to defer to — this skill orchestrates everything itself via the subagents above. Handle every shape here:

- **Batch:** the user passes a file path containing multiple tickets (e.g. `docs/tickets/`) — curate the full set with the analyst, sequence by dependency, and drive every task to its own commit.
- **Unattended:** the user says "all tickets" or "run everything" — same loop; keep the todo list current as visible progress and summarize at the end.
- **Small sets:** a single task or a pasted list of 1–3 items — skip the orchestration overhead and dispatch directly to the right coder.