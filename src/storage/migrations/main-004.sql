-- main-004: self notes (self_note only; batch-2 M1).
-- Original entries are append-only. Revision relationships live in relations.

CREATE TABLE IF NOT EXISTS self_notes (
  id                       TEXT PRIMARY KEY,
  idempotency_key          TEXT NOT NULL UNIQUE,
  at                       TEXT NOT NULL,
  payload_hash             TEXT NOT NULL,
  observation_id           TEXT NOT NULL REFERENCES observations (id),
  text                     TEXT NOT NULL,
  reason                   TEXT NOT NULL,
  basis_refs               TEXT NOT NULL DEFAULT '[]',
  reflection_judgment_ids  TEXT NOT NULL DEFAULT '[]',
  author_runtime           TEXT NOT NULL,
  origin                   TEXT NOT NULL,
  state_snapshot           TEXT NOT NULL,
  initial_strength         REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1)
);

CREATE INDEX IF NOT EXISTS idx_self_notes_at ON self_notes (at, id);
CREATE INDEX IF NOT EXISTS idx_self_notes_observation ON self_notes (observation_id);

CREATE TRIGGER IF NOT EXISTS trg_self_notes_no_update
BEFORE UPDATE ON self_notes
BEGIN
  SELECT RAISE(ABORT, 'self_notes_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_self_notes_no_delete
BEFORE DELETE ON self_notes
BEGIN
  SELECT RAISE(ABORT, 'self_notes_append_only');
END;
