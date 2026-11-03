-- main-009: quiz (self-study exam) ledger. Derived study state only:
-- never a second authority for facts, uses or verdicts.
-- quiz_state is mutable progress; quiz_attempts keeps one row per exam.

CREATE TABLE IF NOT EXISTS quiz_state (
  memory_id   TEXT PRIMARY KEY REFERENCES memories (id),
  level       INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_at     TEXT,
  last_score  REAL CHECK (last_score IS NULL OR (last_score >= 0 AND last_score <= 1)),
  best_score  REAL CHECK (best_score IS NULL OR (best_score >= 0 AND best_score <= 1))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories (id),
  mode        TEXT NOT NULL CHECK (mode IN ('pick', 'challenge')),
  score       REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  cover       REAL CHECK (cover IS NULL OR (cover >= 0 AND cover <= 1)),
  sim         REAL CHECK (sim IS NULL OR (sim >= 0 AND sim <= 1)),
  answer      TEXT NOT NULL,
  hits        TEXT NOT NULL DEFAULT '[]',
  missing     TEXT NOT NULL DEFAULT '[]',
  invented    TEXT NOT NULL DEFAULT '[]',
  at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_memory ON quiz_attempts (memory_id, at);
CREATE INDEX IF NOT EXISTS idx_quiz_state_last_at ON quiz_state (last_at);
