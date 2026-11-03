-- main-002: origins, mechanical entity mentions and materialised review/due indexes.

CREATE TABLE IF NOT EXISTS origins (
  path          TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  origin        TEXT NOT NULL,
  author_kind   TEXT NOT NULL,
  at            TEXT NOT NULL,
  proof_refs    TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (path, content_hash)
);

CREATE TRIGGER IF NOT EXISTS trg_origins_no_update
BEFORE UPDATE ON origins
BEGIN
  SELECT RAISE(ABORT, 'origins_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_origins_no_delete
BEFORE DELETE ON origins
BEGIN
  SELECT RAISE(ABORT, 'origins_append_only');
END;

-- Mechanical candidate mention: original bytes + evidence only. No definition,
-- alias, type inference or authority may be stored here.
CREATE TABLE IF NOT EXISTS candidate_entity_registry (
  id             TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations (id),
  source_span    TEXT NOT NULL,
  original_bytes BLOB NOT NULL,
  evidence_refs  TEXT NOT NULL,
  scope_id       TEXT NOT NULL,
  rule_revision  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status = 'candidate'),
  at             TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  UNIQUE (observation_id, source_span, scope_id)
);

CREATE TRIGGER IF NOT EXISTS trg_ce_no_update
BEFORE UPDATE ON candidate_entity_registry
BEGIN
  SELECT RAISE(ABORT, 'candidate_entity_registry_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_ce_no_delete
BEFORE DELETE ON candidate_entity_registry
BEGIN
  SELECT RAISE(ABORT, 'candidate_entity_registry_append_only');
END;

-- Materialised review index; rebuildable from candidates, pending and needs-review.
CREATE TABLE IF NOT EXISTS review_queue (
  id               TEXT PRIMARY KEY,
  object_kind      TEXT NOT NULL CHECK (object_kind IN ('candidate', 'pending', 'needs-review', 'capture')),
  object_id        TEXT NOT NULL,
  review_policy    TEXT NOT NULL,
  policy_revision  TEXT NOT NULL,
  deadline_at      TEXT,
  created_input_seq INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  close_reason     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (object_kind, object_id)
);

CREATE INDEX IF NOT EXISTS idx_review_queue_open
  ON review_queue (status, deadline_at);

-- Materialised due index; rebuildable from memories plus due-state events.
CREATE TABLE IF NOT EXISTS due_queue (
  memory_id     TEXT PRIMARY KEY REFERENCES memories (id),
  due_state     TEXT NOT NULL
                CHECK (due_state IN ('none', 'pending-due', 'shelved-due', 'open', 'pending-done', 'cooled-due', 'done', 'dropped')),
  enqueued_seq  INTEGER NOT NULL,
  enqueued_at   TEXT NOT NULL,
  opened_at     TEXT,
  deadline_at   TEXT,
  revision      INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_due_queue_state
  ON due_queue (due_state, enqueued_seq);

CREATE INDEX IF NOT EXISTS idx_relations_dedupe
  ON relations (dedupe_key);
