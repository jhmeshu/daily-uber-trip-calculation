CREATE TABLE rides (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  status TEXT NOT NULL CHECK(status IN ('draft','reviewed','deleted')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_at TEXT,
  deleted_at TEXT, previous_status TEXT CHECK(previous_status IN ('draft','reviewed')),
  CHECK((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK(status != 'reviewed' OR reviewed_at IS NOT NULL)
) STRICT;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  ride_id TEXT UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  base_revision INTEGER, revision INTEGER NOT NULL CHECK(revision > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE confirmations (
  id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, signature TEXT NOT NULL, confirmed_at TEXT NOT NULL
) STRICT;
CREATE TABLE history (
  id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  action TEXT NOT NULL, before_data TEXT CHECK(before_data IS NULL OR json_valid(before_data)),
  after_data TEXT CHECK(after_data IS NULL OR json_valid(after_data)), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX history_ride ON history(ride_id, created_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
INSERT INTO settings(key,value) VALUES ('timezone','"Asia/Dhaka"');
