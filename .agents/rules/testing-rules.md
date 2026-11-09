---
trigger: model_decision
description: Testing rules for the node:test unit/integration suites and the Playwright browser suites.
---

# Testing Rules

## Two Frameworks, Split by Filename

| Kind                       | Files                 | Framework              | Command             |
|----------------------------|-----------------------|------------------------|---------------------|
| Unit / integration / API   | `tests/*.test.ts`     | `node:test` via `tsx`  | `npm test`          |
| Browser / E2E              | `tests/*.spec.ts`     | `@playwright/test`     | `npm run test:e2e`  |

`npm test` runs `tsx --test tests/*.test.ts` and Playwright runs `testMatch: '**/*.spec.ts'`. The split is by filename and is strict — never name a Playwright spec `.test.ts` or a node:test file `.spec.ts`.

- Playwright runs `workers: 1` and `headless: true`. It installs Chromium once via `npx playwright install chromium`.
- `npm run test:e2e` runs **real Tesseract OCR** and takes minutes. It is not a quick gate.

## Unit / Integration Conventions

- Flat top-level `test()` calls from `node:test`. **No `describe()` blocks.**
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  ```
- Available assertions: `assert.equal`, `assert.deepEqual`, `assert.notEqual`, `assert.ok`, `assert.throws`, `assert.rejects`. There is no chai-style `expect`.
- Local factory functions at the top of each file — `function ride(overrides: Partial<Ride> = {})`, `function complete()`, `function altered(archive, mutate)` — so a test states only what it varies.

## Testing Patterns

- **AAA structure** with blank-line separation: arrange, act, assert.
- **Never touch real user data.** Every test that constructs a `Store` uses a temporary root:
  ```ts
  const dir = mkdtempSync(join(tmpdir(), 'uber-<name>-'));
  try { const store = new Store(dir); /* ... */ } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  ```
  A test that can corrupt `~/Library/Application Support/Uber Ride Tracker` is a defect, not a hazard.
- **Deterministic fixtures, never the ambient clock or network.** Pass explicit dates into anything date-dependent. A test that passes at 03:00 local time and fails at noon is broken.
- **Synthetic images only.** Generate them with `sharp({ create: { ... } })` or render `tests/fixtures/synthetic-trip.svg`. Never commit a real screenshot.
- **Failure injection via SQLite triggers** is the established way to test error paths:
  ```sql
  CREATE TRIGGER reject_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;
  ```
- **No swallowed errors.** Assert that failures surface as typed errors (`assert.throws(..., ValidationError)`) or as the correct HTTP status, not as a generic 500.
- **HTTP tests boot the real server** on port `0` and use `fetch`. Use a raw `node:http` request when the test needs to forge a `Host` header — that is how the host/origin guards are covered.

## Test Titles

Titles are sentence-like, behavioural, and carry their traceability id when the test maps to an acceptance criterion:

```ts
test('A04: unknown is distinct from explicit zero', () => { /* ... */ });
test('A05 and A06: exact paisa calculations', () => { /* ... */ });
test('A20: API rejects foreign origin, host, and cross-site requests', () => { /* ... */ });
```

Post-MVP tests drop the prefix and describe the behaviour alone:

```ts
test('Duration uses hh:mm:ss and cash net excludes known tips exactly', () => { /* ... */ });
```

## E2E Conventions

- Every spec builds its own module-level server fixture: `test.beforeAll` creates a `mkdtempSync` root, a `Store`, and `createApp(store)`, then listens on `0`. `test.afterAll` closes and removes it.
- Select **only** by role and accessible name: `page.getByRole('button', { name: 'Save reviewed', exact: true })`, `page.getByLabel('Cash collected', { exact: true })`. CSS-class selectors are a last resort.
- `test.setTimeout(120000)` on anything that touches OCR.
- Block the network explicitly and assert nothing escaped:
  ```ts
  page.route('**/*', route => { if (!route.request().url().startsWith(base)) { outside.push(route.request().url()); return route.abort(); } return route.continue(); });
  expect(outside).toEqual([]);
  ```
- Collect `pageerror` events and assert the array is empty at the end.
- Use `expect.poll` for server-state assertions, `page.waitForEvent('download')` for CSV and ZIP exports, and `test.skip(!process.env.UBER_OCR_SAMPLE, ...)` for anything needing the owner's real screenshot.
- Screenshots go to `/tmp`, never into `tests/`.

## Quality Gate

- `npm run typecheck` and `npm test` must pass before staging and committing.
- `npm run test:e2e` must pass before committing a change to a user-facing flow.
- **Never claim a suite passed that was not run.** Record "not run, skipped" explicitly in any report.