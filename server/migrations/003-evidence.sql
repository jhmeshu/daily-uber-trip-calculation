CREATE TABLE field_observations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ocr_runs(id) ON DELETE CASCADE,
 field TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), exact_text TEXT NOT NULL,
 position TEXT CHECK(position IS NULL OR json_valid(position)), confidence REAL NOT NULL,
 parser_version TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(run_id,field,value,exact_text)
) STRICT;
CREATE TABLE field_decisions (
 ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE, field TEXT NOT NULL,
 value TEXT NOT NULL CHECK(json_valid(value)), observation_id TEXT REFERENCES field_observations(id) ON DELETE SET NULL,
 origin TEXT NOT NULL CHECK(origin IN ('extracted','corrected','manual')), explained TEXT NOT NULL,
 evidence_signature TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(ride_id,field)
) STRICT;
CREATE TABLE duplicate_decisions (
 ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
 signature TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE trip_identifiers (ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE, identifier TEXT NOT NULL) STRICT;

CREATE TABLE review_events (id TEXT PRIMARY KEY, ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE, action TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL) STRICT;
