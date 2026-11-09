---
name: handle-ticket
description: End-to-end ticket handler. From a ticket file, create the ticket branch from the recorded base branch, create the implementation plan, break it into tasks, orchestrate implementation with per-task commits, then verify and report — and ff-merge the verified branch into the base branch when a merge-to-base cycle is active. Nothing is pushed without explicit user authorization. Use when the user wants one ticket handled start-to-finish.
---

# Handle Ticket Skill

Run a single ticket end-to-end by chaining four existing skills in order:

```
ticket → /create-implementation-plan → /breakdown-plan-into-tasks → /orchestrator → /verify-deliverable
```

Each sub-skill is invoked **sequentially** (one at a time — never nested/parallel). You drive the chain in the main context: invoke a sub-skill, let it finish and write its artifact, capture the artifact path, pass it to the next step.

## Inputs

User provides a **ticket file path**, e.g.:

- `docs/tickets/A23-duplicate-trip-detection.md`
- `docs/tickets/A25-monthly-summary-timezone.md`
- Absolute or relative path to a single `*.md` ticket

If no input is provided, **ask** for it. Do not guess.

Optional flag: **`--merge-to-base`** — after verify accepts, ff-merge the ticket branch into the base branch and delete the local ticket branch (local-only; pushes stay unauthorized unless the cycle recorded `push: authorized`).

**Mode resolution** (first match wins): explicit `--merge-to-base` → `branching: merge-to-base` in `.context/dev-cycle/state.md` (when a dev-cycle is active) → default `per-ticket`.

**Base branch resolution**: `base_branch:` in `.context/dev-cycle/state.md` → the current branch at start (record it in the report). Never hardcode a branch name.

**Push resolution**: `push: authorized` in state.md when a dev-cycle is active; standalone, nothing is pushed — the final report lists the branch and the suggested push command, and pushing happens only on an explicit user statement.

## Authorization (read before running)

Invoking this skill **is standing approval** to:

- **Set up the ticket branch** — `git fetch --all`, then create + checkout the ticket branch from **local `base_branch` as it stands** (its current tip; in a merge-to-base cycle that tip already contains the previously merged tickets):
  - Branch names per the git-guidelines rule (`fix/<slug>` for bugs, `feature/<slug>` otherwise; ticket id is cited in commit subjects, not branch names).
  - **Refuse to start on a dirty working tree** — stop and surface; never stash, never reset, never discard anything.
  - There is **no reset-to-origin step anywhere in this skill**. Local `base_branch` is the source of truth for the base; staleness vs origin is the user's concern, not something to "fix" destructively.
  - Skip setup only if already on the ticket branch.
- **Commit** via the `committer` agent — **one commit per task**, this repo's plain-sentence convention; no per-commit confirmation pause. Cite the ticket id (`A<nn>`) in the commit subject when there is one.
- **Run the verification suite** for verification **by default**:
  ```
  npm run typecheck   # tsc --noEmit
  npm test            # tsx --test tests/*.test.ts
  npm run build       # setup:ocr + tsc --noEmit + vite build
  npm run test:e2e    # Playwright — only when a user-facing flow changed; runs real OCR, takes minutes
  ```
  (Fall back to static review only if the user has stated they have no local Node toolchain — see Phase 4.)
- **Merge after verify accepts** (Phase 6) per mode:
  - **per-ticket**: nothing — the verified ticket branch stays local.
  - **merge-to-base**: `git merge --ff-only <ticket-branch>` into `base_branch`, then `git branch -d <ticket-branch>`. Conflicts → resolve-and-retry, max 3 attempts, then stop and surface — never `--no-ff`, never a fallback merge commit.
- **Push only when `push: authorized` was recorded** — after any merge or on a per-ticket branch, the push runs only if the cycle state says so or you explicitly asked; otherwise report and move on.
- **Never** rebase pushed/shared history, amend, or force-push. Rebasing the **local, unpushed ticket branch** during merge-to-base conflict resolution is allowed. A `gaps-found` verdict merges and pushes nothing.

State this to the user before starting: "Handling {ticket} on branch {ticket-branch} from {base_branch} ({per-ticket|merge-to-base}). Implement, commit per task, verify, then {merge into {base_branch} locally | leave the branch local}. Nothing is pushed unless you authorized pushes for this run."

## Setup

1. Resolve the ticket path to absolute. Read it to capture:
   - **Ticket ID** (e.g. `A23`) — from the heading or filename
   - **Type** — bug / feature / enhancement (infer from content)
   - **Slug** — short, hyphenated, lowercased, derived from the title
   - **Dependencies** — Depends-on references (sequential chain or none)
2. Compute the branch name: bug → `fix/<slug>`, feature / enhancement → `feature/<slug>`.
3. **Branch setup** (authorized above). Resolve mode + `base_branch` first, then:
   - **Already on the ticket branch** → no action.
   - **Dirty working tree** → stop and surface (the user decides what happens to their changes).
   - Else:
     ```
     git fetch --all
     git checkout -b <ticket-branch> <base_branch>
     ```
4. Track the phases below with the task tools for visibility.

## Artifact paths chain by naming convention

Example for `docs/tickets/A23-duplicate-trip-detection.md`:

| Artifact | Path |
|----------|------|
| Plan | `docs/tickets/A23-duplicate-trip-detection-plan.md` |
| Tasks | `docs/tickets/A23-duplicate-trip-detection-plan-tasks.md` |
| Verification | `.context/tickets/A23/findings/verify-<YYYY-MM-DD>.md` — written by `verify-deliverable`; summary line appended to `.context/tickets/A23/report.md` |

## Phases

### Phase 1 — Plan

Invoke the **`create-implementation-plan`** skill: pass `args: "<ticket-path>"`.

It reads the ticket, analyzes the codebase, and writes the plan to the **same folder** as the ticket.

After it finishes: verify the plan file exists (expected `{ticket-dir}/{ticket-basename}-plan.md`), then capture its absolute path as **`planFile`**. If the sub-skill reported a different path, use that.

### Phase 2 — Break into tasks

Invoke the **`breakdown-plan-into-tasks`** skill: `args: "<planFile>"`.

It analyzes the plan against the codebase and writes a parallelizable task breakdown alongside it.

After it finishes: verify the tasks file exists (expected `{plan-dir}/{plan-basename}-tasks.md`), capture its absolute path as **`tasksFile`**.

### Phase 3 — Implement (orchestrate + per-task commits)

Invoke the **`orchestrator`** skill: `args: "<tasksFile>"`.

- Let the orchestrator implement and verify **all** tasks (it dispatches to the coder agents as the task layers dictate) and commit **per task** via the `committer` agent — its default. Pass the **ticket ID** as context so each commit message cites it.
- Do **not** override the per-task cadence. Never push.

Capture the list of files that changed and the commit hashes.

If the orchestrator reports a blocker or a coder returns a failure, surface it and stop (do not silently skip or commit a broken task).

### Phase 4 — Verify (build + completeness)

Two complementary checks:

1. **Completeness** — invoke the **`verify-deliverable`** skill: `args: "<ticket-path> + <planFile> + base <base_branch>"`. It checks acceptance criteria against the implementation (intent conformance) AND the plan against the implementation, then writes a per-AC verdict report to `.context/tickets/<ticket-id>/findings/verify-<YYYY-MM-DD>.md` (its canonical location per the context-cache rule). Capture the path it reports as **`verificationFile`**.
2. **Build/tests** — **run the verification suite by default**:
   ```
   npm run typecheck   # tsc --noEmit
   npm test            # tsx --test tests/*.test.ts
   npm run build       # setup:ocr + tsc --noEmit + vite build
   npm run test:e2e    # Playwright — only when a user-facing flow changed; runs real OCR, takes minutes
   ```
   **Missing scripts are not failures.** Early code may predate a script: if `npm run` reports a script is not defined, record "`<script>` not defined, skipped" in the final report and continue — do not treat it as a failed check. A script that exists and fails IS a failure. Fold the results (pass / fail / skipped-not-defined, failing tests if any) into the final report.

   **Static review fallback** — only if the user has stated they have no local Node/npm toolchain, **skip** the test run and rely on the `verify-deliverable` report alone. In that case, state plainly that tests were **not** executed and verification is **static review only**.

### Phase 5 — Docs commit

Commit the planning artifacts produced by Phases 1, 2, and 4 as a single docs commit via the `committer` agent: the plan and tasks files (beside the ticket in `docs/tickets/`) plus the verification report (under `.context/tickets/<ticket-id>/findings/`), e.g. `Add duplicate-trip detection plan, tasks, and verification (A23)`. Stage explicit paths from both locations. (Skip if there are none or the user declines.)

### Phase 6 — Integrate (only on an accepted verdict)

A `gaps-found` verdict integrates nothing — report the gaps and stop (in a dev-cycle, the fix loop takes over).

- **per-ticket**: the verified ticket branch stays local. When `push: authorized`, `git push -u origin <ticket-branch>`; otherwise include it in the report's "push-ready branches" list.
- **merge-to-base**:
  1. Confirm the working tree is clean (stop and surface if not — the docs commit in Phase 5 normally guarantees this).
  2. `git checkout <base_branch>` then `git merge --ff-only <ticket-branch>`.
  3. **On ff failure** (base moved): go back to the ticket branch, `git rebase <base_branch>` resolving conflicts as they arise (read each conflict, integrate both intentions, `git add`), then retry the ff-only merge. Each full attempt counts; **after 3 failed attempts stop — `git rebase --abort` / `git merge --abort` as applicable — and surface the exact state**. The user decides; never fall back to a merge commit.
  4. `git branch -d <ticket-branch>` (safe delete — it is merged; if git refuses, surface, never `-D`).
  5. When `push: authorized`: `git push origin <base_branch>`. There is no CI in this repository — a `push: authorized` push of the base is therefore a release decision made by hand.

## Output (final report)

Return a concise end-to-end summary:

- **Ticket** — ID, type, title, one-line summary; branch + base + mode (`per-ticket` / `merge-to-base`)
- **Artifacts** — links to `planFile`, `tasksFile`, `verificationFile`
- **Implementation** — what got built (per task area, files touched)
- **Commits** — hash + message for each per-task code commit, plus the docs commit
- **Verification outcome** — `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` results (or explicit "not run — static review only" / "script not defined, skipped"); completeness counts (✅ implemented / ⚠️ partial / ❌ missing / 🔄 modified); any gaps surfaced
- **Integration** — what Phase 6 did (merged into base locally / branch left local + push-ready / nothing — gaps-found)
- **Pushes** — none (default) unless `push: authorized`; list any push that ran and the pushed refs
- **Open items** — anything blocked, failing tests, or left to the user

## Error Handling

- **Ticket unreadable / missing ID** — ask the user; do not proceed.
- **Dirty working tree at setup or merge time** — stop and surface; never clean up the user's changes yourself.
- **Sub-skill's artifact not found after it returns** — note the expected path, re-check, and ask the user before continuing (the next phase depends on it).
- **Orchestrator blocker / coder failure** — do not commit further; report and stop.
- **Verification suite fails** — report the failure verbatim; fall back to static review for the report; do not claim green tests. **Script not defined in `package.json`** — not an error; report "script not defined, skipped".
- **Verification finds gaps** — do not auto-fix, do not integrate; surface them in the final report for the user to decide.
- **Merge-to-base: 3 failed conflict rounds** — abort the in-progress merge/rebase, report the conflicting files and branch states, stop.

## Key Principles

- **Sequential sub-skills.** One skill invocation at a time; capture each artifact before invoking the next.
- **Per-task commits, plain-sentence convention.** Let the orchestrator commit after each task.
- **No resets, ever.** Ticket branches fork from local `base_branch` as it stands; a dirty tree is a stop, not something to clean.
- **Integration is mode-driven and verdict-gated.** Only an accepted verdict merges (merge-to-base); pushes happen only when explicitly authorized — never as a side effect.
- **Verify for real by default.** Run `npm run typecheck` and `npm test` (plus `npm run build`, and `npm run test:e2e` for user-facing flows) when code is touched; a script that is not yet defined is reported as skipped, not failed; only fall back to static review when the user has no local toolchain, and say so explicitly.
- **Honest reporting.** Never claim a build/test passed that wasn't actually run.
