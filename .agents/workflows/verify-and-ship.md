---
description: Run all quality checks (npm run typecheck, npm test, npm run build), fix failures, stage explicit files, and commit.
agent: build
---

Verify and commit changes.

Usage: `/verify-and-ship`

Runs `npm run typecheck`, `npm test`, and `npm run build` (add `npm run test:e2e` for user-facing flows); verifies zero regressions; stages modified files explicitly; commits with this repo's plain-sentence message style.

Never pushes.
