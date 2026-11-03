-- control-004: persisted step links for cross-database operations and the
-- compile snapshot's cross-library revisions.

ALTER TABLE context_snapshots ADD COLUMN source_revisions TEXT;

CREATE TABLE IF NOT EXISTS operation_steps (
  id                  TEXT PRIMARY KEY,
  parent_operation_id TEXT NOT NULL,
  step_name           TEXT NOT NULL,
  child_operation_id  TEXT NOT NULL,
  target_db           TEXT NOT NULL CHECK (target_db IN ('main', 'control', 'dream')),
  target_ids          TEXT NOT NULL DEFAULT '[]',
  payload_hash        TEXT,
  at                  TEXT NOT NULL,
  UNIQUE (parent_operation_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_operation_steps_parent
  ON operation_steps (parent_operation_id, step_name);

CREATE TRIGGER IF NOT EXISTS trg_operation_steps_no_update
BEFORE UPDATE ON operation_steps
BEGIN
  SELECT RAISE(ABORT, 'operation_steps_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_operation_steps_no_delete
BEFORE DELETE ON operation_steps
BEGIN
  SELECT RAISE(ABORT, 'operation_steps_append_only');
END;
