-- main-006: project identity only. Four-field state lives in project-update events.

CREATE TABLE IF NOT EXISTS projects (
  id                    TEXT PRIMARY KEY,
  idempotency_key       TEXT NOT NULL UNIQUE,
  at                    TEXT NOT NULL,
  payload_hash          TEXT NOT NULL,
  origin                TEXT NOT NULL,
  name                  TEXT NOT NULL,
  scene                 TEXT NOT NULL DEFAULT 'work' CHECK (scene = 'work'),
  created_at            TEXT NOT NULL,
  approval_receipt_id   TEXT NOT NULL,
  registry_change_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects (name);

CREATE TRIGGER IF NOT EXISTS trg_projects_no_update
BEFORE UPDATE ON projects
BEGIN
  SELECT RAISE(ABORT, 'projects_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_no_delete
BEFORE DELETE ON projects
BEGIN
  SELECT RAISE(ABORT, 'projects_append_only');
END;

-- One revision per project; revision is service-assigned, never model-supplied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_update_revision
  ON relations (json_extract(payload, '$.projectId'), json_extract(payload, '$.revision'))
  WHERE type = 'project-update';
