---
trigger: model_decision
description: Security rules for the loopback-only server, local file handling, and error sanitation.
---

# Security Rules

## Sacred Rules

- **Never weaken the loopback guards.** Host validation, Origin validation, and the `Sec-Fetch-Site` check exist because the app is reachable by anything running as the same OS user, including a page in the user's browser. Treat removing any of them as a security regression, not a simplification.
- **Never log or echo secrets.** The app has no credentials today. If one is ever added — an OCR API key, a passphrase — it goes in a gitignored `.env` and never in a response, a log line, a backup, or a commit.
- **Never bypass a verification guard** (`--no-verify`, skipped tests, commented-out assertions).

## Defenses Already in Place — Do Not Remove

`server/app.ts` sets, on every response:
- `X-Content-Type-Options: nosniff`
- a strict `Content-Security-Policy`: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `frame-ancestors 'none'`, `base-uri 'none'`
- `Cache-Control: no-store`

Plus:
- `req.headers.host` must equal exactly `127.0.0.1:<port>`, else `403`.
- A cross-origin `Origin` header, or `Sec-Fetch-Site: cross-site`, is `403`.
- Static paths are containment-checked: `resolve(dist, '.' + decoded)` then `file.startsWith(dist + sep)`.

`wasm-unsafe-eval` exists because Tesseract compiles WASM at runtime. It is the only escape hatch and it stays scoped to `script-src`.

## Attack Surface & Defenses

1. **Input validation.** Every mutation body passes through the `exact(obj, keys)` helper — an unknown *or* a missing key is a `ValidationError`. Every path id goes through `requireId(id)` against the UUID pattern before it reaches storage. Never index a path segment without validating it.
2. **Body and upload limits.** JSON bodies are capped at 4,500,000 bytes. Image uploads at `MAX_FILE_BYTES` (10 MB). Restore archives at 200 MB. Enforce the cap before reading the whole body into memory, and never raise a cap to make a test pass.
3. **No external network at runtime.** OCR assets are served from `/ocr/` out of `public/ocr/`, populated by `npm run setup:ocr` and gitignored. Never substitute a CDN URL, a Google Fonts link, or any remote `fetch`. A test that asserts zero off-origin requests enforces this.
4. **Declared content type must match decoded content.** `sharp` decodes the image; its actual format must equal the declared MIME type and the stored mime. Reject the mismatch rather than trusting the extension.
5. **Path traversal in uploads and restore.** Archive entries and source filenames are attacker-controlled. Reject absolute paths, `..` segments, symlinks, and anything resolving outside the target directory.
6. **Zip-bomb defence.** Restore enforces a 200 MB compressed cap, a 512 MB expansion cap, 10,000 entry cap, and a 100 MB `data.json` cap. Do not remove these without replacing them.
7. **CSV formula injection.** User-authored text in an exported cell is prefixed with an apostrophe when it begins with a formula-like character. Preserve that behaviour when touching `src/shared/csv.ts`.
8. **Error sanitation.** The 500 response body is a fixed string. Never interpolate a filesystem path, SQL text, a `sharp` message, or a driver error into a response. Never return a stack trace.
9. **Multi-step writes** run inside `store.transaction(...)` so a partial write cannot leave a ride without its history row.
10. **File permissions.** Data directories are created `0o700`; files are written `0o600` with `flag: 'wx'`, then `.tmp` + `renameSync`. Generated storage keys are `${uuid}.${ext}` — never the user's filename.
11. **Confirmation on destruction.** `trash`, `restore`, `purge`, and `restore/activate` require `confirmed: true` alongside a matching `revision`. Restore also stages first and flips `current.json` atomically, retaining the prior generation.
12. **Image limits.** Reject images beyond the documented per-image byte and megapixel caps before decode work is done, so a decompression bomb cannot exhaust memory.

## Secrets and Personal Data

- Real trip screenshots, licence plates, and the owner's phone number are personal data. Keep them out of the repository, out of `test-results/`, and out of any AI-generated report.
- Reference the real samples only through the `UBER_OCR_SAMPLE` environment variable so they stay on disk outside the repo.
- Full-database ZIP backups contain personal data. Never write one into the repo.