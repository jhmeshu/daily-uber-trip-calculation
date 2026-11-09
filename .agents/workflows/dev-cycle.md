---
description: Run the full agentic development cycle — product management (clarification rounds) → A tickets → batch approval → per-ticket build (plan, tasks, implement, commit) → verify against deliverable → done or fix loop. Backlog entry mode skips pm + tickets and feeds entries straight to build/verify. A 30-minute watchdog keeps the build phase alive. Nothing is pushed without explicit user authorization — local-only integration by default.
agent: build
---

Run the full agentic development cycle. This chains product management, ticket creation, and per-ticket implementation together. State-driven and resumable — re-run `/dev-cycle` (no args) to advance from wherever the cycle paused.

Usage: `/dev-cycle [mode] [--merge-to-base] [--push]`

Modes:
- `start [issues...]` — Start a new cycle with issues (inline or pasted)
- `continue` — Resume from where the cycle paused
- `backlog` — Start from existing `docs/TODO.md` entries (skip PM + tickets)

Flags:
- `--merge-to-base` — after each ticket's verify accepts: ff-merge the ticket branch into the base branch and delete the local ticket branch, then loop. Default (`per-ticket`): verified branches stay local; integration is yours.
- `--push` — authorize `git push` for the cycle (remember, pushes are never standing-approved). Without it, nothing is ever pushed and the final report lists the local branches waiting for you.

Notes:
- A 30-minute watchdog covers the whole build phase — if the session dies, the cron heartbeat resumes from `.context/dev-cycle/state.md`.
- The full sequencer spec (state schema, watchdog, phases) is the `dev-cycle` skill; this command is its entry point.
