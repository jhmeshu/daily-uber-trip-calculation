CREATE TABLE import_sources (
  id TEXT PRIMARY KEY CHECK(length(id)=36), filename TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  bytes INTEGER NOT NULL CHECK(bytes>0), detected_tabs TEXT NOT NULL CHECK(json_valid(detected_tabs)),
  imported_at TEXT NOT NULL, note TEXT NOT NULL
) STRICT;
CREATE TABLE import_rows (
  id TEXT PRIMARY KEY CHECK(length(id)=36), source_id TEXT NOT NULL REFERENCES import_sources(id),
  sheet_name TEXT NOT NULL, sheet_row INTEGER NOT NULL CHECK(sheet_row>0), layout TEXT NOT NULL,
  raw_cells TEXT NOT NULL CHECK(json_valid(raw_cells)), mapped TEXT NOT NULL CHECK(json_valid(mapped)),
  disposition TEXT NOT NULL CHECK(disposition IN ('imported','skipped','needs_field')),
  missing_fields TEXT NOT NULL CHECK(json_valid(missing_fields)),
  ride_id TEXT REFERENCES rides(id) ON DELETE SET NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_id,sheet_name,sheet_row)
) STRICT;
CREATE TABLE import_variance (
  id TEXT PRIMARY KEY CHECK(length(id)=36), source_id TEXT NOT NULL REFERENCES import_sources(id),
  sheet_name TEXT NOT NULL, location TEXT NOT NULL, metric TEXT NOT NULL,
  workbook_reported TEXT, workbook_formula TEXT, app_value_paisa INTEGER, difference_paisa INTEGER,
  verdict TEXT NOT NULL CHECK(verdict IN ('match','variance','not_comparable','defect')),
  note TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX import_variance_source ON import_variance(source_id);