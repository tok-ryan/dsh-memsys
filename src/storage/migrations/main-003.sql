-- main-003: exposure and activity projections used by the injection organ.

CREATE TABLE IF NOT EXISTS injections (
  round_id     TEXT NOT NULL,
  memory_id    TEXT NOT NULL,
  slots        TEXT NOT NULL DEFAULT '[]',
  topic_hits   INTEGER NOT NULL DEFAULT 0,
  manifest_hash TEXT,
  receipt_id   TEXT,
  at           TEXT NOT NULL,
  PRIMARY KEY (round_id, memory_id)
);

CREATE TABLE IF NOT EXISTS uses (
  memory_id    TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_delivery
  ON memories (scene, scope, due_state, recorded_at);
CREATE INDEX IF NOT EXISTS idx_memories_topic_lookup
  ON memories (topic_key, recorded_at);
