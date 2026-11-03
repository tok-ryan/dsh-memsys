import { canonicalJson } from '../identity.mjs';

const TABLES = ['observations', 'candidates', 'memories', 'relations', 'import_items', 'timeline', 'pointers'];
const ID_TABLES = {
  observations: 'id',
  candidates: 'id',
  memories: 'id',
  relations: 'id',
  import_items: 'id',
};

function rowHash(row) {
  return canonicalJson({ ...row });
}

export function compareBusinessCounts({ db, expected = {} }) {
  const missing = [];
  const counts = {};
  for (const [table, minimum] of Object.entries(expected)) {
    if (!TABLES.includes(table)) continue;
    const actual = Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    counts[table] = actual;
    if (actual < Number(minimum)) missing.push(table);
  }
  return { ok: missing.length === 0, missing, counts };
}

export function snapshotBusinessCounts(db) {
  const counts = {};
  for (const table of TABLES) {
    counts[table] = Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
  }
  return counts;
}

export function snapshotBusinessRows(db) {
  const ids = {};
  const content = {};
  for (const [table, key] of Object.entries(ID_TABLES)) {
    const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY ' + key).all();
    ids[table] = rows.map((row) => row[key]);
    content[table] = Object.fromEntries(rows.map((row) => [row[key], rowHash(row)]));
  }
  const links = {};
  for (const memoryId of ids.memories ?? []) {
    const timeline = db.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(memoryId) ?? null;
    const pointer = db.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memoryId) ?? null;
    const evidence = db.prepare('SELECT id FROM evidence WHERE memory_id = ? ORDER BY id').all(memoryId).map((row) => row.id);
    links[memoryId] = {
      timeline: timeline ? rowHash(timeline) : null,
      pointer: pointer ? rowHash(pointer) : null,
      evidence,
    };
  }
  return { counts: snapshotBusinessCounts(db), ids, content, links };
}

export function compareBusinessRows({ db, baseline = {} }) {
  const missing = [];
  const ids = baseline.ids ?? {};
  const content = baseline.content ?? {};
  for (const [table, key] of Object.entries(ID_TABLES)) {
    for (const id of ids[table] ?? []) {
      const row = db.prepare('SELECT * FROM ' + table + ' WHERE ' + key + ' = ?').get(id);
      if (!row) {
        missing.push(table + ':' + id);
        continue;
      }
      const expectedHash = content[table]?.[id];
      if (expectedHash && rowHash(row) !== expectedHash) {
        missing.push(table + ':content:' + id);
      }
    }
  }
  for (const memoryId of ids.memories ?? []) {
    const expected = baseline.links?.[memoryId];
    const timeline = db.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(memoryId) ?? null;
    const pointer = db.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memoryId) ?? null;
    const evidence = db.prepare('SELECT id FROM evidence WHERE memory_id = ? ORDER BY id').all(memoryId).map((row) => row.id);
    if (!timeline || !pointer || evidence.length === 0) {
      missing.push('memory_links:' + memoryId);
      continue;
    }
    if (expected) {
      if ((timeline ? rowHash(timeline) : null) !== expected.timeline) missing.push('timeline:content:' + memoryId);
      if ((pointer ? rowHash(pointer) : null) !== expected.pointer) missing.push('pointer:content:' + memoryId);
      if (canonicalJson(evidence) !== canonicalJson(expected.evidence)) missing.push('evidence:content:' + memoryId);
    }
  }
  const counts = compareBusinessCounts({ db, expected: baseline.counts ?? {} });
  for (const key of counts.missing) missing.push('count:' + key);
  return { ok: missing.length === 0, missing, counts: counts.counts };
}

const FREEZE_TABLES = {
  main: ['observations', 'candidates', 'memories', 'relations', 'timeline', 'pointers', 'evidence', 'import_items', 'graph_nodes', 'graph_edges'],
  control: ['operations', 'object_streams', 'context_snapshots', 'snapshot_groups', 'snapshot_items', 'operation_attempts'],
  dream: ['dreams', 'propositions', 'relations', 'confirmation_snapshots'],
};

function tableFingerprint(db, table) {
  const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
  return { count: rows.length, hash: canonicalJson(rows) };
}

export function snapshotDatabaseFreeze({ main, control, dream }) {
  const freeze = { versions: {}, tables: {} };
  for (const [label, db] of Object.entries({ main, control, dream })) {
    if (!db) continue;
    freeze.versions[label] = Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
    freeze.tables[label] = {};
    for (const table of FREEZE_TABLES[label] ?? []) {
      freeze.tables[label][table] = tableFingerprint(db, table);
    }
  }
  return freeze;
}

export function compareDatabaseFreeze({ main, control, dream }, freeze = {}) {
  const missing = [];
  for (const [label, db] of Object.entries({ main, control, dream })) {
    if (!db || !freeze.versions?.[label]) continue;
    const version = Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
    if (version !== Number(freeze.versions[label])) missing.push(label + ':version');
    for (const [table, expected] of Object.entries(freeze.tables?.[label] ?? {})) {
      const actual = tableFingerprint(db, table);
      if (actual.count !== expected.count) missing.push(label + ':' + table + ':count');
      else if (actual.hash !== expected.hash) missing.push(label + ':' + table + ':content');
    }
  }
  return { ok: missing.length === 0, missing };
}
