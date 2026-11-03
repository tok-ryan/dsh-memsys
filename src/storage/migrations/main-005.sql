-- main-005: judgments, speculations, the two-column view and reference checks.

CREATE TABLE IF NOT EXISTS judgments (
  id                TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  at                TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,
  observation_id    TEXT NOT NULL REFERENCES observations (id),
  phase             TEXT CHECK (phase IN ('work', 'life')),
  verdict_text      TEXT NOT NULL,
  basis             TEXT NOT NULL,
  falsifier         TEXT NOT NULL,
  evidence_refs     TEXT NOT NULL DEFAULT '[]',
  evidence_origin   TEXT NOT NULL,
  topic_key         TEXT,
  topic_components  TEXT,
  registry_revision TEXT,
  key_status        TEXT NOT NULL DEFAULT 'unresolved'
                    CHECK (key_status IN ('resolved', 'unresolved')),
  binding_status    TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (binding_status IN ('proposed', 'accepted')),
  binding_basis     TEXT,
  outcome           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'done', 'reverted', 'failed')),
  proof_scope       TEXT,
  origin            TEXT NOT NULL,
  state_snapshot    TEXT NOT NULL,
  initial_strength  REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1)
);

CREATE TABLE IF NOT EXISTS speculations (
  id                    TEXT PRIMARY KEY,
  idempotency_key       TEXT NOT NULL UNIQUE,
  at                    TEXT NOT NULL,
  payload_hash          TEXT NOT NULL,
  observation_id        TEXT NOT NULL REFERENCES observations (id),
  text                  TEXT NOT NULL,
  basis                 TEXT NOT NULL,
  falsifier             TEXT NOT NULL,
  basis_refs            TEXT NOT NULL DEFAULT '[]',
  linked_judgment_ids   TEXT NOT NULL DEFAULT '[]',
  origin                TEXT NOT NULL,
  state_snapshot        TEXT NOT NULL,
  initial_strength      REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1)
);

CREATE INDEX IF NOT EXISTS idx_judgments_topic ON judgments (topic_key);
CREATE INDEX IF NOT EXISTS idx_judgments_at ON judgments (at, id);

-- outcome is the action result; verdict_result is the correctness ruling.
-- They are deliberately two independent columns; NULL verdict_result means
-- "no verdict yet" and is not the same as the pending enum.
CREATE VIEW IF NOT EXISTS judgment_current AS
SELECT
  j.id AS id,
  COALESCE(json_extract(s.value, '$.outcome'), j.outcome) AS outcome,
  COALESCE(json_extract(s.value, '$.outcomeRevision'), 0) AS outcome_revision,
  json_extract(s.value, '$.verdict.result') AS verdict_result,
  json_extract(s.value, '$.verdict.id') AS verdict_id,
  COALESCE(json_extract(s.value, '$.needsReview'), 0) AS needs_review,
  COALESCE(json_extract(s.value, '$.unreviewed'), 0) AS unreviewed
FROM judgments AS j
LEFT JOIN state AS s ON s.key = 'judgment:' || j.id;

CREATE TRIGGER IF NOT EXISTS trg_judgments_no_update
BEFORE UPDATE ON judgments
BEGIN
  SELECT RAISE(ABORT, 'judgments_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_judgments_no_delete
BEFORE DELETE ON judgments
BEGIN
  SELECT RAISE(ABORT, 'judgments_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_speculations_no_update
BEFORE UPDATE ON speculations
BEGIN
  SELECT RAISE(ABORT, 'speculations_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_speculations_no_delete
BEFORE DELETE ON speculations
BEGIN
  SELECT RAISE(ABORT, 'speculations_append_only');
END;

-- A judgment must point at a model-authored original output observation.
CREATE TRIGGER IF NOT EXISTS trg_judgments_model_observation
BEFORE INSERT ON judgments
WHEN NOT EXISTS (
  SELECT 1 FROM observations
  WHERE id = NEW.observation_id AND source = 'model' AND author_kind = 'model'
)
BEGIN
  SELECT RAISE(ABORT, 'judgment_observation_not_model');
END;

CREATE TRIGGER IF NOT EXISTS trg_speculations_model_observation
BEFORE INSERT ON speculations
WHEN NOT EXISTS (
  SELECT 1 FROM observations
  WHERE id = NEW.observation_id AND source = 'model' AND author_kind = 'model'
)
BEGIN
  SELECT RAISE(ABORT, 'speculation_observation_not_model');
END;

-- New candidates / memories may only reference an existing judgment id.
CREATE TRIGGER IF NOT EXISTS trg_candidates_judgment_ref
BEFORE INSERT ON candidates
WHEN NEW.judgment_id IS NOT NULL AND NEW.judgment_id <> ''
 AND NOT EXISTS (SELECT 1 FROM judgments WHERE id = NEW.judgment_id)
BEGIN
  SELECT RAISE(ABORT, 'judgment_ref_missing');
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_judgment_ref
BEFORE INSERT ON memories
WHEN NEW.judgment_id IS NOT NULL AND NEW.judgment_id <> ''
 AND NOT EXISTS (SELECT 1 FROM judgments WHERE id = NEW.judgment_id)
BEGIN
  SELECT RAISE(ABORT, 'judgment_ref_missing');
END;
