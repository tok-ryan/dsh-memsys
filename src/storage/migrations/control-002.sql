-- control-002: compilation, snapshot pagination, delivery and capacity ledgers.

CREATE TABLE IF NOT EXISTS compilations (
  id               TEXT PRIMARY KEY,
  round_id         TEXT NOT NULL,
  stream_key       TEXT NOT NULL,
  source_revision  INTEGER NOT NULL,
  policy_revision  TEXT NOT NULL,
  delivery_level   TEXT NOT NULL
                   CHECK (delivery_level IN ('full', 'compressed', 'grouped', 'protected_overflow')),
  payload_hash     TEXT NOT NULL,
  section_text     TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (round_id, stream_key)
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id               TEXT PRIMARY KEY,
  compilation_id   TEXT NOT NULL REFERENCES compilations (id),
  round_id         TEXT NOT NULL,
  mode             TEXT NOT NULL,
  source_revision  INTEGER NOT NULL,
  policy_revision  TEXT NOT NULL,
  delivery_level   TEXT NOT NULL,
  eligible_ids     TEXT NOT NULL,
  expected_ids     TEXT NOT NULL,
  deferred_groups  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  retention_days   INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS snapshot_groups (
  snapshot_id    TEXT NOT NULL REFERENCES context_snapshots (id),
  group_id       TEXT NOT NULL,
  name           TEXT NOT NULL,
  total_count    INTEGER NOT NULL,
  deferred_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, group_id)
);

CREATE TABLE IF NOT EXISTS snapshot_items (
  snapshot_id    TEXT NOT NULL REFERENCES context_snapshots (id),
  memory_id      TEXT NOT NULL,
  group_id       TEXT NOT NULL,
  ordinal        INTEGER NOT NULL,
  directory_text TEXT NOT NULL,
  scene          TEXT NOT NULL,
  category       TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, memory_id)
);

CREATE TABLE IF NOT EXISTS deliveries (
  round_id      TEXT PRIMARY KEY,
  snapshot_id   TEXT NOT NULL,
  delivery      TEXT NOT NULL CHECK (delivery IN ('unknown', 'incomplete', 'confirmed')),
  receipt_hash  TEXT,
  received_ids  TEXT,
  at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capacity_rounds (
  round_id               TEXT PRIMARY KEY,
  snapshot_id            TEXT NOT NULL,
  hard_count             INTEGER NOT NULL,
  hard_bytes             INTEGER NOT NULL,
  hard_tokens            REAL NOT NULL,
  H                      REAL,
  K                      REAL NOT NULL,
  soft_count             INTEGER NOT NULL,
  soft_bytes             INTEGER NOT NULL,
  soft_tokens            REAL NOT NULL,
  soft_H                 REAL,
  delivery_level         TEXT NOT NULL,
  full_directory_bytes   INTEGER NOT NULL,
  payload_bytes          INTEGER NOT NULL,
  tokens                 REAL NOT NULL,
  group_count            INTEGER NOT NULL,
  subgroup_count         INTEGER NOT NULL,
  eligible_count         INTEGER NOT NULL,
  deferred_count         INTEGER NOT NULL,
  soft_over_streak       INTEGER NOT NULL DEFAULT 0,
  hard_over_streak       INTEGER NOT NULL DEFAULT 0,
  protected_over_streak  INTEGER NOT NULL DEFAULT 0,
  policy_version         TEXT NOT NULL,
  at                     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_round ON context_snapshots (round_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_group ON snapshot_items (snapshot_id, group_id, ordinal);
