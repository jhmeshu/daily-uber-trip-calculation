---
name: dev-cycle
description: Full agentic development cycle — product management (clarification rounds) → A tickets → batch approval → per-ticket build (plan, tasks, implement, commit) → verify against deliverable → done or fix loop. Backlog entry mode skips pm + tickets and feeds entries straight to build/verify. Launch with --merge-to-base to ff-merge each verified ticket into the working branch. A 30-minute watchdog keeps the build phase alive. Nothing is pushed without explicit user authorization — local-only integration by default. State-driven and resumable — re-run /dev-cycle (no args) to advance from wherever the cycle paused. Use when user wants the whole flow from issues to committed implementation.
---

# Dev Cycle Skill

State-machine sequencer chaining existing skills. Two entry modes:

```
backlog mode:     docs/TODO.md → [user approves batch] → /handle-ticket (per entry) → /verify-deliverable (per ticket) → done | fix loop
pm mode:           /product-management → /convert-to-tickets → [user approves batch] → /handle-ticket (per ticket) → /verify-deliverable (per ticket) → done | fix loop
```

You are the thin sequencer. State lives in `.context/dev-cycle/state.md`. Every invocation: read state → run the current phase → update state → stop at the next pause point. You never do phase work yourself — invoke the sub-skill or tell the user what's needed.

## State file

```markdown
# dev-cycle state
mode: backlog | pm                              # entry mode; backlog = docs/TODO.md scope
phase: pm | tickets | awaiting-approval | build | verify | fix | done
started: YYYY-MM-DD HH:mm
pm_cycle: .context/pm-cycles/pm-cycle-<ts>       # pm mode only, set at phase tickets
base_branch: <branch>                           # integration branch — the branch the cycle was launched on; never hardcoded
branching: per-ticket | merge-to-base           # set at cycle start (flag or default); resume preserves it
push: none | authorized                         # set at cycle start (--push or the user's explicit statement); resume preserves it
watchdog: none                                  # cron id / timer mechanism once the build-phase watchdog starts
tickets:                                        # set at awaiting-approval
  - A23
  - A24
approved: [A23, A24]                            # set when user approves
ticket_index: 0                                 # build/verify cursor
current_ticket: A23
overrides: []                                   # user-ordered deviations for this cycle, one per line
fix_rounds: {}
log:
  - <one line per phase transition, timestamped>
```

## Invocation modes

- **With `docs/TODO.md` as scope** (explicitly given, or the supplied file is a TODO-entry backlog with `A<nn>` ids) → **backlog mode**: write fresh `state.md` (`mode: backlog`, `phase: awaiting-approval`, `tickets:` = every `A<nn>` in backlog order), then run the awaiting-approval phase. The `pm` and `tickets` phases are skipped: the backlog is already the ticket source, and its entries feed build/verify directly.
- **With issues** (text or file path) → new cycle in **pm mode**: write fresh `state.md` (`mode: pm`, `phase: pm`), then run PM phase.
- **No args** → resume: read `state.md`, run current phase. If no state file exists, ask for issues. On resume the recorded `branching`, `base_branch`, and `push` always win — never flip modes mid-cycle.
- **`--new`** with issues or the backlog → archive old state (rename `state.md` → `state-<date>.md`), start fresh.

### Flags (accepted on any starting invocation)

- **`--merge-to-base`** — after each ticket's verify accepts: ff-merge the ticket branch into `base_branch` and delete the local ticket branch, then loop to the next ticket. Sets `branching: merge-to-base`. Merge is local-only in itself.
- **`--push`** — authorize `git push` for the cycle: ticket branches (per-ticket mode) and/or `base_branch` (merge-to-base mode after each merge). Records `push: authorized`. Without it, `push: none` — nothing is ever pushed and the final report lists the local branches waiting for you. Per the project's git-guidelines sacred rule, an invocation alone is never push authorization — the flag or your explicit statement is.
- Default (`branching: per-ticket`, `push: none`): verified ticket branches stay local; integration is yours.

`base_branch` is the branch the cycle was launched on — recorded verbatim, never guessed, never hardcoded to `main`.

## Authorization

Invoking this skill **is standing approval** for everything its sub-skills authorize (PM cycle folders; ticket file writes; ticket branch creation from local `base_branch`; per-task commits via `committer`; verification runs — `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` when a user-facing flow changed) **plus the mode's merge step, executed by `handle-ticket` after verify accepts**:

- **per-ticket** (default): nothing to integrate — the ticket branch remains local.
- **merge-to-base**: ff-only merge of the verified ticket branch into `base_branch`, then `git branch -d` on the merged ticket branch. Local operations only.

**Pushes are never standing-approved.** `git push` happens only when `push: authorized` is in state.md (the `--push` flag or your explicit statement set it). There is no CI in this repository, so a `--push`-authorized push of `main` is a release decision made by hand — that recorded authorization is what makes it allowed.

**Never** rebase pushed/shared history, amend, force-push, or create merge commits (`--no-ff`) — those remain the user's call. PRs via `gh` are also the user's call unless they ask otherwise.

## Watchdog — 30-minute build-phase liveness heartbeat

Long autonomous stretches die silently (API failures, harness restarts) and can idle for hours before anyone notices. The watchdog is a 30-minute liveness loop covering the **entire autonomous stretch** — every `handle-ticket` invocation, verify run, and fix round, from `build` entry until `done`. **Never started per-ticket** — one lifecycle per build phase.

**Lifecycle**

- **Start once** at `build` entry (after batch approval). If `watchdog:` in state.md is not `none`, one is already running — do not start another (crash resumes must not stack duplicates).
- Record the mechanism in `watchdog:` (`<cron-id>`, `crontab`, `schtasks`, `launchd:<label>`, …).
- **Heartbeat logic** (every 30 minutes; keep tolerance = interval + one tick of margin — agents can be silent far longer than a tick while thinking or running tests, and a threshold equal to the interval false-positives on live sessions):
  1. **Freshness** — any file under `src/`, `server/`, `tests/`, `docs/`, or `.context` modified in the last ~35 minutes → the cycle is alive; no action.
  2. **Gate check** — read `state.md`. If `phase:` is `done`, or a user-gate pause (`pm` with questions pending, `awaiting-approval`, `fix` with round-2 exhausted) → **stop the watchdog** (self-delete), report once, no action.
  3. **Stalled mid build/verify/fix** → resume: read `.context/dev-cycle/state.md`, note `phase`, `current_ticket`, `ticket_index`, and the `overrides`; continue the loop for `current_ticket` exactly as before — plan, tasks, coder dispatch, committer, verify report, docs commit, integrate per push policy, advance state. Do not re-do completed tickets; trust state.md and the task list.
- **Stop paths (all valid, any actor)**: the heartbeat stops itself on `done`/user-gate pause (rule 2); the sequencer stops it at any deliberate pause point; the user can stop it manually at any time.

**Instantiation**

- **Command Code / Claude Code** — `cron_create` (`*/30 * * * *`) whose prompt is the heartbeat logic above, plus "use cron_list to find and cron_delete this watchdog job" in rule 2. Store the returned job id in `watchdog:`. Stop with `cron_delete`.
- **OpenCode / Kilo / Antigravity / ZCode / tools without a native timer** — write `.context/dev-cycle/watchdog.sh` and install a `*/30 * * * *` crontab line (macOS/Linux), a launchd label, or a Windows `schtasks` job. Script contract:
  - `flock`-guarded — no overlapping runs;
  - the freshness + gate logic above, reading `state.md`;
  - on stall: spawn `<tool> run "<resume prompt>"` detached — a **fresh** session (state.md is the whole context; do **not** `--continue`, it drags the dead session's context along);
  - on done/user-gate pause: **self-uninstall** (disable/remove its own timer unit and crontab line);
  - log actions to `.context/dev-cycle/watchdog.log`.
- Headless `run` spawns bypass interactive permission gates — the resume prompt is repo-scoped by construction; keep it that way.

## Phases

Backlog mode (`mode: backlog`) skips `pm` and `tickets` entirely — state enters at `awaiting-approval` with the entries from `docs/TODO.md` as the ticket list.

### pm — invoke `product-management`

`Skill("product-management", args: "<issues or empty>")`.

- PM returns **awaiting answers** → tell the user which question file to answer and that re-running `/dev-cycle` continues. Stop.
- PM returns **deliverables complete** → capture `pm_cycle` folder, advance to `tickets`.

### tickets — invoke `convert-to-tickets`

`Skill("convert-to-tickets", args: "<pm_cycle>/deliverables.md")`.

Capture generated ticket ids. Advance to `awaiting-approval`.

### awaiting-approval — human gate

Show the user: ticket table (id, title, source — backlog entry from `docs/TODO.md` or DEL from a PM cycle, dependency order) + suggested build order (dependencies first; in backlog mode that is simply backlog order). Ask: ship all / subset (by id) / hold. Record `approved`, order it, reset `ticket_index: 0`, advance to `build`.

Also ask here whether the cycle may push once verified (`push: authorized`) — THIS is the explicit authorization point; default stays "everything stays local".

Use question tool here — this is a one-shot interactive gate, not PM-style file clarification.

### build — invoke `handle-ticket` per approved ticket, sequentially

Start the watchdog (section above) on first entry, then:
`Skill("handle-ticket", args: "<ticket-file>[ --merge-to-base][ --push]")` for `approved[ticket_index]` (flags only when the corresponding state field says so).

- **pm mode:** ticket file = `docs/tickets/A<nn>-<slug>.md` written by the tickets phase.
- **backlog mode:** ticket file = `docs/TODO.md`, passing the current entry id — the `A<nn>` entry itself is the ticket (Goal = problem, Scope = requirements, Done when = acceptance criteria, Depends on = dependencies).

One at a time — parallel is impossible in one working tree. `handle-ticket` owns branch setup: it reads `base_branch` and `branching` from this state file and forks each ticket branch (`feature|fix/<id>-<slug>`) from **local `base_branch` as it stands when the ticket starts** — no resets, ever. In `merge-to-base` the base advances with each ticket's merge; in `per-ticket` it advances only if you merge ticket branches yourself — sequencing tickets with unmerged dependencies is your call (this workflow has no merge gate; it never pauses to ask).

- Ticket completes → capture its report (commits, branch, integration outcome) into `state.md` log, increment `ticket_index`.
- An unverified ticket is never merged or pushed — `handle-ticket`'s Integrate phase only runs on an accepted verdict.
- `handle-ticket` blocker → surface, stop, phase stays `build`. The watchdog keeps watching; its resume re-enters at `current_ticket`.
- All tickets built → advance to `verify`.

Note: `handle-ticket` phase 4 runs `verify-deliverable` internally. The dedicated `verify` phase below is the authoritative deliverable-level gate; if handle-ticket's run already produced an accepted verdict for a ticket, reuse it and skip re-verification.

### verify — invoke `verify-deliverable` per ticket, sequentially

`Skill("verify-deliverable", args: "<ticket-file> + <plan-file> + base <base_branch>")`.

- Reuse `handle-ticket`'s accepted verdict where one exists; otherwise verify now.
- Verdict **accepted** → integration already happened in `handle-ticket`'s Integrate phase (local merge into `base_branch`, and a push if `push: authorized`) — record the outcome, mark the ticket done, next ticket. **Never merge or push twice.**
- Verdict **gaps-found** → advance phase to `fix` with `current_ticket` set (nothing was merged or pushed for this ticket).
- All verified → phase `done`.

### fix — targeted gap fixes (max 2 rounds per ticket)

From the verify report's "Gaps requiring action":

1. Write a minimal fix-tasks file `.context/tickets/<id>/fix-round-<n>-tasks.md` (one task per gap, acceptance criterion quoted).
2. Invoke `Skill("orchestrator", args: "<fix-tasks-file>")` — coders fix, `committer` commits per fix task.
3. Re-invoke `verify-deliverable`.
4. Accepted → back to `verify` (resume remaining tickets). Still gaps after round 2 → **stop**, report gaps, phase stays `fix`, **stop the watchdog** (a user gate follows) — user decides (manual fix, more rounds, or accept partial). Do not loop forever.

### done — final report

Stop the watchdog (`cron_delete` / script self-uninstall — verify `watchdog:` back to `none` in state.md), then report concisely:

- Cycle folder + tickets: id, title, branch, commits (hash + subject), integration outcome per ticket (local branch / merged into base / pushed — only when `push: authorized`)
- Per-ticket verdict: accepted / partial (what's open), test results
- Unverifiable ACs requiring manual checks (e.g. OCR against a real driver screenshot supplied via `UBER_OCR_SAMPLE`, a full backup/restore round trip against the owner's real data directory, an actual CSV round trip through a spreadsheet app)
- Next steps: in `per-ticket` mode or when `push: none`, list the local branches with suggested push commands — pushes are your call; prune `.context/tickets/<id>/` folders or copy `report.md` into `docs/` if you want it kept

## Pause points (where you stop and why)

| Phase | Pause | Resume |
|-------|-------|--------|
| pm | questions await answers | user answers, re-runs `/dev-cycle` |
| awaiting-approval | batch approval | user picks tickets |
| fix | round-2 gaps persist | user decides |
| done | cycle complete | `--new` for next cycle |

Build/verify have no pause gates — a stall there is a crash, and the watchdog resumes it.

## Error handling

- Sub-skill artifact missing after it returns → re-check expected path; if truly absent, report and stop (later phases depend on it).
- State file corrupt/ambiguous → show it to the user, propose a repair, do not guess silently.
- Skill tool fails to load a sub-skill → report, stop.
- Never advance phase on a failed sub-step.
- Watchdog duplicate or orphaned (two timers, unknown cron id) → stop the extras, keep one, fix `watchdog:` in state.md.

## Key principles

- **Thin sequencer.** Phases belong to sub-skills; you read state, invoke, capture, relay.
- **Resumable by construction.** All progress in `state.md`; any crash/session-end resumes cleanly — the watchdog is just automation over that property.
- **Branch mode is state, not memory.** `branching`, `base_branch`, and `push` live in state.md; resumes honor them without being told.
- **Watchdog on, exactly one.** Started at build entry, self-terminating at done/pause, never duplicated.
- **Cache-aware.** Sub-skills handle `.context` findings per `.agents/rules/context-cache.md`; you never pull source into main context.
- **Two human gates only**: PM answers + batch approval. Fix-round-2 exhaustion adds a third only when something is wrong.
