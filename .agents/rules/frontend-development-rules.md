---
trigger: model_decision
description: Frontend development rules for React 19 + Vite 8 + plain CSS in this repo.
---

# Frontend Development Rules

## UI Framework & Design System

- **Runtime:** React 19.3 with the automatic JSX runtime (`jsx: "react-jsx"`). No `import React` needed except where `React.Fragment` or a namespace type is actually used.
- **Bundler:** Vite 8. The build output in `dist/` is served by the Node server; there is no dev proxy.
- **Styling:** one plain stylesheet, `src/style.css`, using BEM-ish class names (`.shell`, `.panel`, `.trip-group`, `.queue-card`, `.error-text`).
- **Strict Prohibition:** do not add a component library, a CSS-in-JS runtime, or a utility-CSS framework. There is no Tailwind, no Ant Design, no shadcn. The dependency list is closed and intentional.
- **Icons:** there is no icon package. Icons are text glyphs. Do not add one for a single icon.

## State Management

- Local `useState` / `useRef` only. No Context, no store library, no global mutable module state.
- `src/main.tsx` owns the app shell, the page switch, and cross-panel state. Panels receive props and callbacks; they do not fetch on their own except through `api()`.
- Two patterns are load-bearing and must be preserved:
  - **Unmount guards.** `let alive = true; ... return () => { alive = false; }` — never `setState` after unmount.
  - **Sequence guards.** Capture a sequence number before an async read and discard the response if it is no longer current (`if (sequence !== loadSequence.current) return;`). Without this, a slow first load overwrites a fast second one.
- Autosave is debounced (400 ms) and serialized through a promise-chain ref so saves cannot interleave.

## Async Data & Feedback Contract

- All HTTP goes through `api<T>(path, method, data?)` in `src/api.ts`. No direct `fetch` calls in components.
- A client-computed total is a **preview**. Label it as such. The server recomputes and wins.
- Every async submit reflects its in-flight state. A save button that can be double-clicked into two writes is a bug.
- User-facing failures render as `<p role="alert">` with the message from `(e as Error).message`. Never swallow a catch body silently — an empty `catch {}` needs a `//` comment explaining exactly what is deliberately ignored and why.
- Non-`Error` throws are coerced: `e instanceof Error ? e.message : String(e)`.
- Distinguish cancellation from failure. `AbortController` aborts surface as an `AbortError` `DOMException` and are not user-facing errors.

## Money, Dates, and Unknowns

- Display money only through `money(value)` (`BDT x.xx`, or `Unknown` for `null`). Never hand-format a paisa number in a component.
- Durations render through `formatDuration(seconds)` (`hh:mm:ss`).
- **A blank field is unknown, not zero.** Never prefill an empty money input with `0`, and never send a coerced `0` for a field the user left blank.
- Disabled or read-only states must visually distinguish "unknown" from "zero".

## Accessibility (load-bearing)

- E2E tests select **exclusively** by role and accessible name. Any control without a `label` or `aria-label` breaks the browser suite.
- Errors use `role="alert"`; progress and status notices use `role="status"`.
- Every control is keyboard reachable and has a visible `:focus-visible` outline.
- The layout must not overflow horizontally at a 390px viewport. Verify with `document.documentElement.scrollWidth <= window.innerWidth`.

## Screens

| Page         | Component         | Responsibility                                                                    |
|--------------|-------------------|-----------------------------------------------------------------------------------|
| Rides        | `src/main.tsx`    | Ledger, ride editor, autosave sessions, draft / trash / review status            |
| Import       | `src/ImportPanel.tsx` | Screenshot queue, batch slots, per-image crop / rotate, OCR dispatch            |
| Evidence     | `src/EvidenceReview.tsx` | Per-field candidates, accept / override, duplicate decisions               |
| Source       | `src/SourceViewer.tsx` | The original screenshot behind an observation, with its source box highlighted |
| Dashboard    | `src/Dashboard.tsx`   | Monthly income, reviewed-only totals, date-range filters                      |
| Settings     | `src/Settings.tsx`    | Timezone, data directory, OCR diagnostics, backup / restore                     |

- One component per file in `src/*.tsx`. Co-locate small helpers inside the file that uses them and export them only when another module needs them.
- Props are inline type literals in the destructuring signature, not separate interfaces:
  ```tsx
  export function SourceViewer({ rideId, onRecognized }: { rideId: string | null; onRecognized: () => void })
  ```
- Named exports only, in every file except the two tool configs (`vite.config.ts`, `playwright.config.ts`), which need default exports.

## House Style

This codebase is written in a dense, deliberate style. **Match it.**

- Single quotes, semicolons, trailing commas in multi-line literals, 2-space indent.
- Related statements share a line when they are short: `const v = BigInt(value); const abs = ...; return abs;`
- Very long lines are normal. Whole JSX `<section>` blocks are single lines. Do not reflow existing code to be shorter.
- Comments are rare, always `//`, on their own line, and exist only to record a non-obvious invariant. Never write a comment that describes what the next line does.
- Named exports, `as const` arrays plus a derived union instead of `enum`, SCREAMING_SNAKE module constants.

There is no linter and no formatter in this repo, so consistency is enforced by the author, not a tool. Do not reformat code you were not asked to touch.