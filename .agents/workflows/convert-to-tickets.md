---
description: Convert docs/TODO.md entries or PM deliverables into ticket files under docs/tickets/.
agent: build
---

Convert a backlog or deliverables to tickets.

Usage: `/convert-to-tickets [backlog-path|deliverables-index-path]`

Example: `/convert-to-tickets docs/TODO.md`

Ticket ids continue the project's `A01`–`A22` acceptance-criteria sequence. The counter lives at `docs/tickets/.next-id`.
