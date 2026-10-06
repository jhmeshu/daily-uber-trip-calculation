# Backup format v1

A ZIP contains `data.json` and exactly the original images named in its file manifest. No symlinks, absolute paths, parent-directory segments, directory entries, encrypted/multipart ZIPs, ZIP64 or duplicate names are supported.

`data.json` has `format: "uber-ride-tracker"`, `backup_version: 1`, `schema_version: 3`, ISO `created_at`, `tables` and `files`. Each file entry specifies relative path, byte length and SHA-256. Image keys must match their UUID and decoded MIME/metadata; originals are validated by content and hash. CRC32 validates each ZIP entry before JSON/image validation.

Table names: rides, sessions, confirmations, history, settings, attachments, import_groups, import_items, ocr_runs, upload_batches, upload_slots, field_observations, field_decisions, duplicate_decisions, trip_identifiers, review_events. Exact schema columns are required; unknown columns/tables are rejected. SQLite constraints/foreign keys and domain checks run against a fresh staged database before activation. The backup version is independent of transactional database migration versions.

Snapshots are taken synchronously within a SQLite transaction, followed by reading immutable, reference-owned originals before another event-loop mutation can interleave. Derived income is recomputed after restore. Image previews and OCR binaries are not user-data backup contents.

Restoration stages a generation under the stable data root. After explicit confirmation, an fsynced temporary pointer is renamed atomically to `current.json`, then the application switches its SQLite connection to that generation. Database and original-image files therefore share one generation choice. Active requests spanning a generation change are rejected. The prior generation is retained. Failed activation restores the old pointer/connection; startup after interruption follows the last completed pointer write. Restored unfinished OCR jobs are marked interrupted for retry.

Limits: ZIP 200 MB, expansion 512 MB, at most 10,000 entries; JSON at most 100 MB; each image at most 10 MB and 40 million decoded pixels; each table at most 100,000 rows. These are decimal byte limits. Creation rejects backups exceeding its compatible restore limits. Validation and activation failure injection are tested in `tests/backup.test.ts`.
