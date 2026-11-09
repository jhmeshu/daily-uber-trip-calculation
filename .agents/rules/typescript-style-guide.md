---
trigger: model_decision
description: TypeScript and formatting conventions for this Node 24 + React 19 + Vite codebase.
---

# TypeScript Style Guide

## General Principles

- **Strict mode is on** and `noEmit` — `tsc --noEmit` is the type gate. Never add `any`, `as any`, or a `@ts-ignore` to make an error disappear. Use `unknown` plus a type guard, or fix the type.
- `noUncheckedIndexedAccess` is **off**. The existing code narrows with `!` where a lookup is known to exist. Follow that convention instead of adding a config flag.
- Explicit return types on exported functions, class methods, and anything non-trivial. Arrow-function constants may infer.
- `types: ["node"]` is global, so `process`, `Buffer`, `crypto.randomUUID()` are ambient with no import.

## Imports — extensions are mandatory

`allowImportingTsExtensions` is on, so **every relative import carries its own extension**:

```ts
import { blankRide, validateInput } from '../src/shared/domain.ts';
import { createApp } from './app.ts';
```

- `.ts` for logic and utilities, `.tsx` for components.
- Use `import type { ... }` whenever an import is type-only.
- Node built-ins use the `node:` prefix: `node:sqlite`, `node:http`, `node:fs`, `node:crypto`, `node:path`.
- There is **no path alias** in this repo. Imports are relative. Do not add one.

## Naming Conventions

- **Types:** PascalCase, singular of the entity, no leading `I` prefix.
  ```ts
  export type RideInput = { trip_date: string; cash_collected_paisa: number | null; /* ... */ };
  ```
- **Components:** PascalCase filenames matching the component (`EvidenceReview.tsx`).
- **Helpers and functions:** camelCase (`parseDecimal`, `cleanLocation`, `requireId`).
- **Constants:** `SCREAMING_SNAKE_CASE` at module scope (`MAX_FILE_BYTES`, `PARSER_VERSION`, `BACKUP_TABLES`, `csvHeaders`).
- **Enums:** never `enum`. Use an `as const` array plus a derived union.
  ```ts
  export const paymentMethods = ['Cash', 'bKash', 'Other', 'Unknown'] as const;
  export type PaymentMethod = typeof paymentMethods[number];
  ```
  This is required for anything that crosses the JSON boundary, because `enum` members do not survive `JSON.parse` as their declared type.

## Formatting

There is no formatter configured. The existing style is dense and consistent; preserve it.

- Single quotes, semicolons, trailing commas in multi-line literals, 2-space indent.
- Space around `=` in declarations; minimal space around operators inside short expressions (`if(x===null)return '';`).
- Long lines are accepted. Do not reformat untouched code.
- Prefer a named exported function over a class when the class has no state or lifecycle beyond the methods.
- Classes are correct when there is real state plus lifecycle: `Store`, `Intake`, `Evidence`, `Backups`.

## Error Handling

- Two domain error types, both from `src/shared/domain.ts` / `server/store.ts`:
  ```ts
  export class ValidationError extends Error {}
  export class ConflictError extends Error {}
  ```
  Throw these. Never invent a third shape and never return an ad-hoc `{ error }` object from inside a service — the HTTP boundary maps error types to status codes.
- `ValidationError` messages are user-facing: one actionable sentence, ending in a period.
- Narrow thrown values at the catch site: `(e as Error).message`, or `e instanceof Error ? e.message : String(e)` when the thrower is untyped.

## Database Code

- `node:sqlite` `DatabaseSync` is synchronous. Do not `await` a prepared statement, and do not reach for an async driver.
- Always use bound parameters (`?`). Never interpolate a value into SQL text.
- Wrap multi-statement writes in `store.transaction(() => ...)`.
- Column value types coming out of SQLite are `unknown`; decode them explicitly (`store.decode` shows the pattern).