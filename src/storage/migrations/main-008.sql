-- main-008: legacy import mapping and the skeleton's original relations.
-- These are audit indexes, never a second authority for facts or evidence.

CREATE TABLE IF NOT EXISTS import_items (
  id                   TEXT PRIMARY KEY,
  source_system        TEXT NOT NULL,
  source_object_id     TEXT NOT NULL,
  source_version_hash  TEXT NOT NULL,
  item_kind            TEXT NOT NULL,
  target_ids           TEXT NOT NULL DEFAULT '[]',
  mapping_policy       TEXT NOT NULL,
  payload_hash         TEXT NOT NULL,
  at                   TEXT NOT NULL,
  UNIQUE (source_system, source_object_id, source_version_hash, item_kind, mapping_policy)
);

CREATE INDEX IF NOT EXISTS idx_import_items_source
  ON import_items (source_system, source_object_id);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  origin       TEXT NOT NULL,
  source_ref   TEXT NOT NULL,
  at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id           TEXT PRIMARY KEY,
  from_id      TEXT NOT NULL REFERENCES graph_nodes (id),
  to_id        TEXT NOT NULL REFERENCES graph_nodes (id),
  kind         TEXT NOT NULL,
  origin       TEXT NOT NULL,
  source_ref   TEXT NOT NULL,
  at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges (from_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges (to_id);

CREATE TRIGGER IF NOT EXISTS trg_import_items_no_update
BEFORE UPDATE ON import_items BEGIN SELECT RAISE(ABORT, 'import_items_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_import_items_no_delete
BEFORE DELETE ON import_items BEGIN SELECT RAISE(ABORT, 'import_items_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_graph_nodes_no_update
BEFORE UPDATE ON graph_nodes BEGIN SELECT RAISE(ABORT, 'graph_nodes_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_graph_nodes_no_delete
BEFORE DELETE ON graph_nodes BEGIN SELECT RAISE(ABORT, 'graph_nodes_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_graph_edges_no_update
BEFORE UPDATE ON graph_edges BEGIN SELECT RAISE(ABORT, 'graph_edges_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_graph_edges_no_delete
BEFORE DELETE ON graph_edges BEGIN SELECT RAISE(ABORT, 'graph_edges_append_only'); END;
