# .context Structure & Findings Cache

`.context/` is gitignored working state for the agentic pipeline. Structure:

```
.context/
  dev-cycle/
    state.md                  # dev-cycle phase machine
  pm-cycles/
    pm-cycle-<ts>/            # PM cycle working folders (see product-management skill)
      state.md, questions/, deliverables/, deliverables.md
  tickets/
    F<nn>/                    # per-ticket working state
      ticket.md               # ticket body (derived from a deliverable)
      findings/
        codebase-<sha7>.md    # analyst codebase digests
        impl-delta.md         # appended by coder agents: what changed + why
        verify-<date>.md      # per-AC verdict table from verify-deliverable
      report.md               # final report: commits, test results, verdict
  cache/
    codebase-map.md           # living architecture map, sections per subsystem
    decisions.md              # append-only decision log
```

## Findings File Contract

Every findings file starts with a header:

```markdown
---
based-on: <commit-sha>       # HEAD sha when the analysis was made
date: YYYY-MM-DD
scope:                       # files/globs the analysis covers
  - src/**
  - server/**
  - src/shared/**
  - tests/**
---
```

## Freshness Check (Before Trusting Findings)

Run:

```bash
git diff --name-only <based-on>..HEAD -- <scope>
```

- **Empty:** Fresh. Use as-is. Do NOT re-analyze.
- **Non-empty:** Stale only for changed paths. Reuse untouched sections; refresh only changed paths.

## Update Rules

1. **Partial refresh:** Stale sections re-analyzed (via `analyst` subagent), untouched sections preserved.
2. **Gap read:** When diff is small (single file/function), read directly without spawning an analyst.
3. **Write-back:** Agents who explore beyond findings update the file before finishing.
4. **Impl deltas:** Coder agents append a short summary to `findings/impl-delta.md` after implementing (files changed, behavior added).
5. **Decisions log:** `cache/decisions.md` is append-only: `YYYY-MM-DD F<nn>: <decision> (context)`.
