-- dream-001: schema-version placeholder only.
-- Batch 1 creates NO dream content tables and registers no dream write service.
-- dreams.db must stay empty of dream facts until batch 3.

CREATE TABLE IF NOT EXISTS db_marker (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO db_marker (name, value) VALUES ('schema_role', 'dream-placeholder');
