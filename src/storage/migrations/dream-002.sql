-- dream-002: independent dream library with in-library FKs, append-only
-- protection and its own commit sequence.

CREATE TABLE IF NOT EXISTS dream_seq (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO dream_seq (name, value) VALUES ('relations', 0);

CREATE TABLE IF NOT EXISTS dreams (
  id                TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  at                TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,
  linked_ids        TEXT NOT NULL DEFAULT '[]',
  basis             TEXT NOT NULL,
  idea              TEXT NOT NULL,
  origin            TEXT NOT NULL,
  author_runtime    TEXT NOT NULL,
  state_snapshot    TEXT NOT NULL,
  initial_strength  REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1)
);

CREATE TABLE IF NOT EXISTS propositions (
  id                TEXT PRIMARY KEY,
  dream_id          TEXT NOT NULL REFERENCES dreams (id),
  ordinal           INTEGER NOT NULL CHECK (ordinal >= 1),
  text              TEXT NOT NULL,
  text_hash         TEXT NOT NULL,
  at                TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  payload_hash      TEXT NOT NULL,
  UNIQUE (dream_id, ordinal)
);

CREATE TABLE IF NOT EXISTS candidates (
  id                TEXT PRIMARY KEY,
  dream_id          TEXT NOT NULL REFERENCES dreams (id),
  proposition_id    TEXT NOT NULL REFERENCES propositions (id),
  text              TEXT NOT NULL,
  basis             TEXT NOT NULL,
  origin            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'inferred'
                    CHECK (status IN ('inferred', 'dead')),
  at                TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  payload_hash      TEXT NOT NULL,
  state_snapshot    TEXT NOT NULL,
  initial_strength  REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1)
);

CREATE TABLE IF NOT EXISTS relations (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  payload          TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL UNIQUE,
  at               TEXT NOT NULL,
  commit_seq       INTEGER NOT NULL,
  ordinal          INTEGER NOT NULL DEFAULT 0,
  event_version    TEXT NOT NULL DEFAULT '2',
  payload_version  TEXT NOT NULL DEFAULT '2'
);

CREATE INDEX IF NOT EXISTS idx_dream_relations_seq ON relations (commit_seq, ordinal);
CREATE INDEX IF NOT EXISTS idx_dream_relations_type ON relations (type, commit_seq);

CREATE TABLE IF NOT EXISTS confirmation_snapshots (
  id                     TEXT PRIMARY KEY,
  confirm_id             TEXT NOT NULL UNIQUE,
  dream_id               TEXT NOT NULL REFERENCES dreams (id),
  proposition_id         TEXT NOT NULL REFERENCES propositions (id),
  payload                TEXT NOT NULL,
  payload_hash           TEXT NOT NULL,
  approval_receipt_id    TEXT NOT NULL,
  original_session_id    TEXT NOT NULL,
  at                     TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_dreams_no_update
BEFORE UPDATE ON dreams BEGIN SELECT RAISE(ABORT, 'dreams_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_dreams_no_delete
BEFORE DELETE ON dreams BEGIN SELECT RAISE(ABORT, 'dreams_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_propositions_no_update
BEFORE UPDATE ON propositions BEGIN SELECT RAISE(ABORT, 'propositions_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_propositions_no_delete
BEFORE DELETE ON propositions BEGIN SELECT RAISE(ABORT, 'propositions_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_dream_candidates_no_update
BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT, 'dream_candidates_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_dream_candidates_no_delete
BEFORE DELETE ON candidates BEGIN SELECT RAISE(ABORT, 'dream_candidates_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_dream_relations_no_update
BEFORE UPDATE ON relations BEGIN SELECT RAISE(ABORT, 'dream_relations_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_dream_relations_no_delete
BEFORE DELETE ON relations
BEGIN
  SELECT RAISE(ABORT, 'dream_relations_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmation_snapshots_no_update
BEFORE UPDATE ON confirmation_snapshots BEGIN SELECT RAISE(ABORT, 'confirmation_snapshots_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_confirmation_snapshots_no_delete
BEFORE DELETE ON confirmation_snapshots BEGIN SELECT RAISE(ABORT, 'confirmation_snapshots_append_only'); END;
