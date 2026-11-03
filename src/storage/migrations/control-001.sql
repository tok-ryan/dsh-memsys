-- control-001: operation ledger, append-only attempt history, stream index.
-- schema_migrations is created by the migration runner before this file runs.

CREATE TABLE IF NOT EXISTS operations (
  operation_id         TEXT PRIMARY KEY,
  object_key           TEXT NOT NULL,
  request_key          TEXT NOT NULL UNIQUE,
  target_db            TEXT NOT NULL,
  immutable_payload    TEXT NOT NULL,
  payload_hash         TEXT NOT NULL,
  target_ids           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  status               TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  frozen               INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
  freeze_reason        TEXT,
  generation           INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_readback        TEXT,
  last_error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_operations_object
  ON operations (object_key, generation, frozen);
CREATE INDEX IF NOT EXISTS idx_operations_status
  ON operations (status, frozen);

-- Attempt lifecycle is append-only: one reserve row and (optionally) one
-- complete row per attempt. completed_at is never back-filled onto reserve.
CREATE TABLE IF NOT EXISTS operation_attempts (
  id            TEXT PRIMARY KEY,
  object_key    TEXT NOT NULL,
  generation    INTEGER NOT NULL,
  attempt_no    INTEGER NOT NULL,
  operation_id  TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('reserve', 'complete')),
  at            TEXT NOT NULL,
  result        TEXT,
  error         TEXT,
  expected_hash TEXT,
  actual_hash   TEXT,
  UNIQUE (object_key, generation, attempt_no, phase)
);

CREATE INDEX IF NOT EXISTS idx_attempts_object
  ON operation_attempts (object_key, generation, attempt_no);

CREATE TABLE IF NOT EXISTS control_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL
             CHECK (type IN ('reserve', 'success', 'failure', 'freeze', 'reconcile', 'unfreeze')),
  object_key TEXT NOT NULL,
  payload    TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_control_events_object
  ON control_events (object_key, at);

CREATE TABLE IF NOT EXISTS object_streams (
  object_key          TEXT PRIMARY KEY,
  target_db           TEXT NOT NULL,
  generation          INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  frozen              INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
  inflight_attempt_no INTEGER,
  updated_at          TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_attempts_no_update
BEFORE UPDATE ON operation_attempts
BEGIN
  SELECT RAISE(ABORT, 'operation_attempts_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_no_delete
BEFORE DELETE ON operation_attempts
BEGIN
  SELECT RAISE(ABORT, 'operation_attempts_append_only');
END;

-- One in-flight attempt per object stream, enforced in the database itself.
CREATE TRIGGER IF NOT EXISTS trg_attempts_single_inflight
BEFORE INSERT ON operation_attempts
WHEN NEW.phase = 'reserve'
 AND EXISTS (
   SELECT 1 FROM object_streams
   WHERE object_key = NEW.object_key AND inflight_attempt_no IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'object_stream_inflight');
END;

CREATE TRIGGER IF NOT EXISTS trg_control_events_no_update
BEFORE UPDATE ON control_events
BEGIN
  SELECT RAISE(ABORT, 'control_events_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_control_events_no_delete
BEFORE DELETE ON control_events
BEGIN
  SELECT RAISE(ABORT, 'control_events_append_only');
END;
