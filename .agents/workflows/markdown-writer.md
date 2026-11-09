---
description: Use when creating, editing, or reviewing any Markdown file (.md, .mdx, README, docs/) in this repo. Covers edge cases LLMs chronically get wrong (hard line breaks, table pipes, nested code fences) and runs deterministic validation.
agent: build
---

Write or edit Markdown files with deterministic validation.

Usage: `/markdown-writer <file-path>`

Example: `/markdown-writer docs/tickets/A23-duplicate-trip-detection.md`

Validate with `node .agents/skills/markdown-writer/validate_md.cjs <file>`.
