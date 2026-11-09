---
description: Research the codebase to answer questions. Search for relevant files, trace data flows, inspect the SQL schema in server/migrations, and provide clear answers without modifying files.
agent: explore
---

Investigate and research the codebase.

Usage: `/investigate <question>`

Example: `/investigate Where is income calculated and how does a draft ride get excluded from the monthly total?`

Read-only. Never open the real data directory — inspect `server/migrations/*.sql` instead.
