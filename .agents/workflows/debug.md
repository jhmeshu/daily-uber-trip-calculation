---
description: Full debugging workflow — reproduce the defect with a failing test, perform root cause analysis, then implement a minimal fix.
agent: build
---

Debug an issue using a structured workflow.

Usage: `/debug <description>`

This runs: reproduce with a failing test → root cause analysis → minimal fix → `npm test` green.

Never point a test at the real data directory — reproduce with a `mkdtempSync` root.
