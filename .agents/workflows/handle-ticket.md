---
description: End-to-end ticket handler. Creates the ticket branch from the recorded base branch, the implementation plan, the task breakdown, orchestrated implementation with per-task commits, then verifies against acceptance criteria — and locally ff-merges into the base branch when a merge-to-base cycle is active. Nothing is pushed without explicit authorization.
agent: build
---

Handle a single ticket end-to-end.

Usage: `/handle-ticket <ticket-path> [--merge-to-base]`

Example: `/handle-ticket docs/tickets/A23-duplicate-trip-detection.md`

Flags:
- `--merge-to-base` — after verify accepts: ff-merge the ticket branch into the base branch and delete the local ticket branch. Default (`per-ticket`): the verified branch stays local. Pushes happen only when `push: authorized` is recorded in `.context/dev-cycle/state.md` or you explicitly ask.
