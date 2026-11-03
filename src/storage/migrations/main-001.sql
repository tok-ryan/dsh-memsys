-- main-001: facts, candidates, memories, evidence, relations and base projections.
-- Observations, evidence and relations are append-only (enforced by triggers).

CREATE TABLE IF NOT EXISTS observations (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  at                 TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  text               TEXT NOT NULL,
  source             TEXT NOT NULL
                     CHECK (source IN ('conversation', 'tool', 'file', 'dream', 'correction', 'model')),
  author_kind        TEXT NOT NULL
                     CHECK (author_kind IN ('owner', 'tool', 'file', 'model', 'unknown')),
  runtime_refs       TEXT NOT NULL,
  origin             TEXT NOT NULL,
  lossy              INTEGER NOT NULL DEFAULT 0 CHECK (lossy IN (0, 1)),
  state_snapshot     TEXT NOT NULL,
  initial_strength   REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1),
  recorded_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_at ON observations (at);

CREATE TABLE IF NOT EXISTS candidates (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  at                 TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  observation_id     TEXT NOT NULL REFERENCES observations (id),
  source_unit        TEXT NOT NULL,
  source_path        TEXT NOT NULL
                     CHECK (source_path IN ('capture', 'tool', 'block', 'dream', 'resolve', 'confirm')),
  text               TEXT NOT NULL,
  detail             TEXT,
  why                TEXT NOT NULL,
  type               TEXT NOT NULL
                     CHECK (type IN ('identity', 'preference', 'promise', 'episode', 'fact', 'emotion', 'procedure')),
  scene              TEXT NOT NULL CHECK (scene IN ('work', 'life', 'both')),
  scope              TEXT NOT NULL CHECK (scope IN ('global', 'work-only', 'life-only')),
  tags               TEXT NOT NULL DEFAULT '[]',
  topic_key          TEXT,
  topic_components   TEXT,
  registry_revision  TEXT,
  structured_value   TEXT,
  semantic_status    TEXT NOT NULL CHECK (semantic_status IN ('quoted', 'proposed', 'accepted')),
  record_kind        TEXT NOT NULL CHECK (record_kind IN ('assertion', 'utterance')),
  origin             TEXT NOT NULL,
  confidence         REAL NOT NULL DEFAULT 0.5,
  lossy              INTEGER NOT NULL DEFAULT 0 CHECK (lossy IN (0, 1)),
  start_at           TEXT,
  end_at             TEXT,
  prec_start         TEXT CHECK (prec_start IN ('minute', 'day', 'month', 'year', 'unknown')),
  prec_end           TEXT CHECK (prec_end IN ('minute', 'day', 'month', 'year', 'unknown')),
  time_state         TEXT NOT NULL DEFAULT 'point'
                     CHECK (time_state IN ('point', 'exact', 'ongoing', 'ended_unknown')),
  due_at             TEXT,
  weight             REAL NOT NULL DEFAULT 5,
  pointer_status     TEXT NOT NULL DEFAULT 'unknown' CHECK (pointer_status IN ('exact', 'unknown')),
  pointer_location   TEXT,
  pointer_search_hint TEXT,
  judgment_id        TEXT,
  creator_session_id TEXT NOT NULL,
  owner_touched      INTEGER NOT NULL DEFAULT 0 CHECK (owner_touched IN (0, 1)),
  reason             TEXT,
  resolved_from      TEXT,
  state_snapshot     TEXT NOT NULL,
  initial_strength   REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'conflicted', 'promoted', 'rejected', 'demoted', 'shelved')),
  promoted_at        TEXT,
  rejected_reason    TEXT,
  review_policy      TEXT NOT NULL,
  policy_revision    TEXT NOT NULL,
  deadline_at        TEXT,
  created_input_seq  INTEGER NOT NULL,
  recorded_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates (status, recorded_at);
CREATE INDEX IF NOT EXISTS idx_candidates_observation ON candidates (observation_id);
CREATE INDEX IF NOT EXISTS idx_candidates_topic ON candidates (topic_key);

CREATE TABLE IF NOT EXISTS memories (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  at                 TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  text               TEXT NOT NULL,
  detail             TEXT,
  why                TEXT NOT NULL,
  type               TEXT NOT NULL
                     CHECK (type IN ('identity', 'preference', 'promise', 'episode', 'fact', 'emotion', 'procedure')),
  scene              TEXT NOT NULL CHECK (scene IN ('work', 'life', 'both')),
  scope              TEXT NOT NULL CHECK (scope IN ('global', 'work-only', 'life-only')),
  tags               TEXT NOT NULL DEFAULT '[]',
  topic_key          TEXT,
  topic_components   TEXT,
  registry_revision  TEXT,
  structured_value   TEXT,
  semantic_status    TEXT NOT NULL CHECK (semantic_status IN ('quoted', 'proposed', 'accepted')),
  record_kind        TEXT NOT NULL CHECK (record_kind IN ('assertion', 'utterance')),
  origin             TEXT NOT NULL,
  credibility        TEXT NOT NULL DEFAULT 'unverified'
                     CHECK (credibility IN ('verified', 'unverified', 'from-dream')),
  lossy              INTEGER NOT NULL DEFAULT 0 CHECK (lossy IN (0, 1)),
  judgment_id        TEXT,
  weight             REAL NOT NULL DEFAULT 5,
  state_snapshot     TEXT NOT NULL,
  initial_strength   REAL NOT NULL CHECK (initial_strength >= 0 AND initial_strength <= 1),
  recorded_at        TEXT NOT NULL,
  promoted_from      TEXT NOT NULL UNIQUE REFERENCES candidates (id),
  due_state          TEXT NOT NULL DEFAULT 'none'
                     CHECK (due_state IN ('none', 'pending-due', 'shelved-due', 'open', 'pending-done', 'cooled-due', 'done', 'dropped')),
  due_done_at        TEXT,
  last_touched_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_due ON memories (due_state);
CREATE INDEX IF NOT EXISTS idx_memories_scene ON memories (scene, scope);
CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories (topic_key);
CREATE INDEX IF NOT EXISTS idx_memories_touched ON memories (last_touched_at);

CREATE TABLE IF NOT EXISTS evidence (
  id                TEXT PRIMARY KEY,
  memory_id         TEXT REFERENCES memories (id),
  candidate_id      TEXT REFERENCES candidates (id),
  observation_id    TEXT REFERENCES observations (id),
  source_memory_id  TEXT REFERENCES memories (id),
  role              TEXT NOT NULL CHECK (role IN ('basis', 'derived')),
  source_span       TEXT NOT NULL,
  at                TEXT NOT NULL,
  CHECK ((memory_id IS NOT NULL) + (candidate_id IS NOT NULL) = 1),
  CHECK ((observation_id IS NOT NULL) + (source_memory_id IS NOT NULL) = 1)
);

-- Four non-null combinations, because SQLite treats NULLs as distinct in UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uk_evidence_m_o
  ON evidence (memory_id, observation_id, role, source_span)
  WHERE memory_id IS NOT NULL AND observation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_evidence_m_sm
  ON evidence (memory_id, source_memory_id, role, source_span)
  WHERE memory_id IS NOT NULL AND source_memory_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_evidence_c_o
  ON evidence (candidate_id, observation_id, role, source_span)
  WHERE candidate_id IS NOT NULL AND observation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_evidence_c_sm
  ON evidence (candidate_id, source_memory_id, role, source_span)
  WHERE candidate_id IS NOT NULL AND source_memory_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_memory ON evidence (memory_id);
CREATE INDEX IF NOT EXISTS idx_evidence_candidate ON evidence (candidate_id);

CREATE TABLE IF NOT EXISTS timeline (
  memory_id   TEXT PRIMARY KEY REFERENCES memories (id),
  start_at    TEXT,
  end_at      TEXT,
  prec_start  TEXT CHECK (prec_start IN ('minute', 'day', 'month', 'year', 'unknown')),
  prec_end    TEXT CHECK (prec_end IN ('minute', 'day', 'month', 'year', 'unknown')),
  time_state  TEXT NOT NULL DEFAULT 'point'
              CHECK (time_state IN ('point', 'exact', 'ongoing', 'ended_unknown')),
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS pointers (
  memory_id   TEXT PRIMARY KEY REFERENCES memories (id),
  status      TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('exact', 'unknown')),
  location    TEXT,
  search_hint TEXT,
  lossy       INTEGER NOT NULL DEFAULT 0 CHECK (lossy IN (0, 1)),
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (status <> 'exact' OR location IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS relations (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  payload          TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL UNIQUE,
  at               TEXT NOT NULL,
  commit_seq       INTEGER NOT NULL,
  ordinal          INTEGER NOT NULL DEFAULT 0,
  event_version    TEXT NOT NULL DEFAULT '1',
  payload_version  TEXT NOT NULL DEFAULT '1'
);

CREATE INDEX IF NOT EXISTS idx_relations_type ON relations (type, commit_seq);
CREATE INDEX IF NOT EXISTS idx_relations_seq ON relations (commit_seq, ordinal);

CREATE TABLE IF NOT EXISTS state (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS config (
  key      TEXT PRIMARY KEY,
  value    TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- Append-only guards.
CREATE TRIGGER IF NOT EXISTS trg_observations_no_update
BEFORE UPDATE ON observations
BEGIN
  SELECT RAISE(ABORT, 'observations_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_observations_no_delete
BEFORE DELETE ON observations
BEGIN
  SELECT RAISE(ABORT, 'observations_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_evidence_no_update
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_evidence_no_delete
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_relations_no_update
BEFORE UPDATE ON relations
BEGIN
  SELECT RAISE(ABORT, 'relations_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_relations_no_delete
BEFORE DELETE ON relations
BEGIN
  SELECT RAISE(ABORT, 'relations_append_only');
END;

-- candidates: only status / promoted_at / rejected_reason / owner_touched are mutable.
CREATE TRIGGER IF NOT EXISTS trg_candidates_immutable_columns
BEFORE UPDATE ON candidates
WHEN NEW.id IS NOT OLD.id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.at IS NOT OLD.at
  OR NEW.payload_hash IS NOT OLD.payload_hash
  OR NEW.observation_id IS NOT OLD.observation_id
  OR NEW.source_unit IS NOT OLD.source_unit
  OR NEW.source_path IS NOT OLD.source_path
  OR NEW.text IS NOT OLD.text
  OR NEW.detail IS NOT OLD.detail
  OR NEW.why IS NOT OLD.why
  OR NEW.type IS NOT OLD.type
  OR NEW.scene IS NOT OLD.scene
  OR NEW.scope IS NOT OLD.scope
  OR NEW.tags IS NOT OLD.tags
  OR NEW.topic_key IS NOT OLD.topic_key
  OR NEW.topic_components IS NOT OLD.topic_components
  OR NEW.registry_revision IS NOT OLD.registry_revision
  OR NEW.structured_value IS NOT OLD.structured_value
  OR NEW.semantic_status IS NOT OLD.semantic_status
  OR NEW.record_kind IS NOT OLD.record_kind
  OR NEW.origin IS NOT OLD.origin
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.lossy IS NOT OLD.lossy
  OR NEW.start_at IS NOT OLD.start_at
  OR NEW.end_at IS NOT OLD.end_at
  OR NEW.prec_start IS NOT OLD.prec_start
  OR NEW.prec_end IS NOT OLD.prec_end
  OR NEW.time_state IS NOT OLD.time_state
  OR NEW.due_at IS NOT OLD.due_at
  OR NEW.weight IS NOT OLD.weight
  OR NEW.pointer_status IS NOT OLD.pointer_status
  OR NEW.pointer_location IS NOT OLD.pointer_location
  OR NEW.pointer_search_hint IS NOT OLD.pointer_search_hint
  OR NEW.judgment_id IS NOT OLD.judgment_id
  OR NEW.creator_session_id IS NOT OLD.creator_session_id
  OR NEW.reason IS NOT OLD.reason
  OR NEW.resolved_from IS NOT OLD.resolved_from
  OR NEW.state_snapshot IS NOT OLD.state_snapshot
  OR NEW.initial_strength IS NOT OLD.initial_strength
  OR NEW.review_policy IS NOT OLD.review_policy
  OR NEW.policy_revision IS NOT OLD.policy_revision
  OR NEW.deadline_at IS NOT OLD.deadline_at
  OR NEW.created_input_seq IS NOT OLD.created_input_seq
  OR NEW.recorded_at IS NOT OLD.recorded_at
BEGIN
  SELECT RAISE(ABORT, 'candidates_immutable_column');
END;

CREATE TRIGGER IF NOT EXISTS trg_candidates_no_delete
BEFORE DELETE ON candidates
BEGIN
  SELECT RAISE(ABORT, 'candidates_not_deletable');
END;

-- memories: only due_state / due_done_at / last_touched_at are event projections.
CREATE TRIGGER IF NOT EXISTS trg_memories_immutable_columns
BEFORE UPDATE ON memories
WHEN NEW.id IS NOT OLD.id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.at IS NOT OLD.at
  OR NEW.payload_hash IS NOT OLD.payload_hash
  OR NEW.text IS NOT OLD.text
  OR NEW.detail IS NOT OLD.detail
  OR NEW.why IS NOT OLD.why
  OR NEW.type IS NOT OLD.type
  OR NEW.scene IS NOT OLD.scene
  OR NEW.scope IS NOT OLD.scope
  OR NEW.tags IS NOT OLD.tags
  OR NEW.topic_key IS NOT OLD.topic_key
  OR NEW.topic_components IS NOT OLD.topic_components
  OR NEW.registry_revision IS NOT OLD.registry_revision
  OR NEW.structured_value IS NOT OLD.structured_value
  OR NEW.semantic_status IS NOT OLD.semantic_status
  OR NEW.record_kind IS NOT OLD.record_kind
  OR NEW.origin IS NOT OLD.origin
  OR NEW.credibility IS NOT OLD.credibility
  OR NEW.lossy IS NOT OLD.lossy
  OR NEW.judgment_id IS NOT OLD.judgment_id
  OR NEW.weight IS NOT OLD.weight
  OR NEW.state_snapshot IS NOT OLD.state_snapshot
  OR NEW.initial_strength IS NOT OLD.initial_strength
  OR NEW.recorded_at IS NOT OLD.recorded_at
  OR NEW.promoted_from IS NOT OLD.promoted_from
BEGIN
  SELECT RAISE(ABORT, 'memories_immutable_column');
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_no_delete
BEFORE DELETE ON memories
BEGIN
  SELECT RAISE(ABORT, 'memories_not_deletable');
END;

-- Projections must move forward with a revision bump; no silent rewrites.
CREATE TRIGGER IF NOT EXISTS trg_timeline_revision
BEFORE UPDATE ON timeline
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'timeline_revision_required');
END;

CREATE TRIGGER IF NOT EXISTS trg_pointers_revision
BEFORE UPDATE ON pointers
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'pointers_revision_required');
END;

CREATE TRIGGER IF NOT EXISTS trg_config_revision
BEFORE UPDATE ON config
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'config_revision_required');
END;
