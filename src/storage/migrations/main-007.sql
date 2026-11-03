-- main-007: explicit key/binding provenance on candidates and memories.
-- New rows must fill all four columns; legacy rows stay NULL and are explained
-- through key-state-backfill events (never rewritten in place).

ALTER TABLE candidates ADD COLUMN key_status TEXT
  CHECK (key_status IS NULL OR key_status IN ('resolved', 'unresolved'));
ALTER TABLE candidates ADD COLUMN binding_status TEXT
  CHECK (binding_status IS NULL OR binding_status IN ('proposed', 'accepted'));
ALTER TABLE candidates ADD COLUMN binding_basis TEXT;
ALTER TABLE candidates ADD COLUMN origin_mode TEXT
  CHECK (origin_mode IS NULL OR origin_mode IN ('self', 'inherited'));

ALTER TABLE memories ADD COLUMN key_status TEXT
  CHECK (key_status IS NULL OR key_status IN ('resolved', 'unresolved'));
ALTER TABLE memories ADD COLUMN binding_status TEXT
  CHECK (binding_status IS NULL OR binding_status IN ('proposed', 'accepted'));
ALTER TABLE memories ADD COLUMN binding_basis TEXT;
ALTER TABLE memories ADD COLUMN origin_mode TEXT
  CHECK (origin_mode IS NULL OR origin_mode IN ('self', 'inherited'));

CREATE TRIGGER IF NOT EXISTS trg_candidates_binding_required
BEFORE INSERT ON candidates
WHEN NEW.key_status IS NULL
  OR NEW.binding_status IS NULL
  OR NEW.binding_basis IS NULL
  OR NEW.origin_mode IS NULL
BEGIN
  SELECT RAISE(ABORT, 'binding_fields_required');
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_binding_required
BEFORE INSERT ON memories
WHEN NEW.key_status IS NULL
  OR NEW.binding_status IS NULL
  OR NEW.binding_basis IS NULL
  OR NEW.origin_mode IS NULL
BEGIN
  SELECT RAISE(ABORT, 'binding_fields_required');
END;

CREATE TRIGGER IF NOT EXISTS trg_candidates_binding_immutable
BEFORE UPDATE ON candidates
WHEN NEW.key_status IS NOT OLD.key_status
  OR NEW.binding_status IS NOT OLD.binding_status
  OR NEW.binding_basis IS NOT OLD.binding_basis
  OR NEW.origin_mode IS NOT OLD.origin_mode
BEGIN
  SELECT RAISE(ABORT, 'binding_columns_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_memories_binding_immutable
BEFORE UPDATE ON memories
WHEN NEW.key_status IS NOT OLD.key_status
  OR NEW.binding_status IS NOT OLD.binding_status
  OR NEW.binding_basis IS NOT OLD.binding_basis
  OR NEW.origin_mode IS NOT OLD.origin_mode
BEGIN
  SELECT RAISE(ABORT, 'binding_columns_immutable');
END;
