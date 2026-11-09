# Google Antigravity & Gemini Workspace Instructions

This workspace is configured for **Google Antigravity** and **Gemini CLI** (`agy`).
Detailed rules, specialized skills, workflows, and subagents are organized in `.agents/`.

## Architecture & Conventions

- **Runtime:** Node 24 only (`engines: >=24.14.0 <25`). `node:sqlite` is required.
- **Application Structure:** Node `node:http` server (`server/app.ts`) plus a React 19 + Vite 8 frontend in `src/`.
- **UI:** plain CSS only (`src/style.css`), BEM-ish class names. No component library, no CSS-in-JS, no utility framework. Local `useState`/`useRef` — no router, no state library.
- **Database & Persistence:** `node:sqlite` `DatabaseSync`. Schema: `server/migrations/*.sql`, applied in order and gated by `PRAGMA user_version`. A migration is two edits: the `.sql` file **and** its filename in `server/store.ts`.
- **Domain Calculations:** pure functions in `src/shared/` (`domain.ts`, `parser.ts`, `csv.ts`, `intake.ts`), imported by **both** server and browser. No `node:*` imports there.
- **Money:** Bangladeshi Taka (BDT, ৳) stored as **integer paisa** in `*_paisa` fields, accumulated with `BigInt`. Decimals only at display and CSV boundaries.
- **Income Invariants:** blank means unknown (never zero); `including = cash + credit - commission - pass`, then `excluding = including - tips`; only `reviewed` rides with no `reviewErrors()` contribute; the server recomputes and never trusts a client total; financial edits invalidate confirmation via `financialSignature()`.
- **Parser Invariant:** an unrecognized layout yields zero observations, never a guess. No silent pick between conflicts. No year inferred from map text. Bump `PARSER_VERSION` on behaviour change.
- **Dates:** local calendar dates, validated with `validDate`/`parseDuration`. Never roll a date forward to complete an unfinished month.
- **Testing:** `node:test` via `tsx` (`tests/*.test.ts`) and Playwright (`tests/*.spec.ts`, real Tesseract OCR, takes minutes). Tests use `mkdtempSync` roots — never the real data directory.
- **Commits:** one plain declarative sentence, no Conventional Commits prefix, no body. Explicit file staging only.
- **AI Documentation:** write analysis reports, findings, and plans to `docs/`. Agent state goes to the gitignored `.context/`.

## Customizations Discovery

- **Rules:** Loaded from `.agents/rules/`
- **Skills:** Loaded from `.agents/skills/`
- **Workflows:** Loaded from `.agents/workflows/`
- **Subagents:** Available under `.agents/agent/` (`analyst`, `committer`, `backend-coder`, `frontend-coder`, `product-manager`)