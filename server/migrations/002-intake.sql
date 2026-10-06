CREATE TABLE attachments (
 id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, storage_key TEXT NOT NULL UNIQUE,
 source_name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 10000000),
 width INTEGER NOT NULL CHECK(width > 0), height INTEGER NOT NULL CHECK(height > 0), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE import_groups (
 id TEXT PRIMARY KEY, ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE import_items (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES import_groups(id) ON DELETE CASCADE,
 attachment_id TEXT NOT NULL REFERENCES attachments(id), transform TEXT NOT NULL CHECK(json_valid(transform)),
 status TEXT NOT NULL CHECK(status IN ('ready','running','complete','failed','cancelled','interrupted')),
 token TEXT, error TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE ocr_runs (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES import_items(id) ON DELETE CASCADE,
 token TEXT NOT NULL, engine TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)),
 transform TEXT NOT NULL CHECK(json_valid(transform)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE upload_batches (id TEXT PRIMARY KEY, descriptors TEXT NOT NULL CHECK(json_valid(descriptors)), created_at TEXT NOT NULL) STRICT;
CREATE TABLE upload_slots (batch_id TEXT NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE, slot INTEGER NOT NULL, attachment_id TEXT NOT NULL REFERENCES attachments(id), PRIMARY KEY(batch_id,slot)) STRICT;
