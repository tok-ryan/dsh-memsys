const TABLES = ['observations', 'candidates', 'memories', 'relations', 'import_items', 'timeline', 'pointers'];

export function compareBusinessCounts({ db, expected = {} }) {
  const missing = [];
  const counts = {};
  for (const [table, minimum] of Object.entries(expected)) {
    if (!TABLES.includes(table)) continue;
    let actual = 0;
    try {
      actual = Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    } catch {
      actual = 0;
    }
    counts[table] = actual;
    if (actual < Number(minimum)) missing.push(table);
  }
  return { ok: missing.length === 0, missing, counts };
}

export function snapshotBusinessCounts(db) {
  const counts = {};
  for (const table of TABLES) {
    try {
      counts[table] = Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    } catch {
      counts[table] = 0;
    }
  }
  return counts;
}

const ID_TABLES = {
  observations: 'id',
  candidates: 'id',
  memories: 'id',
  relations: 'id',
  import_items: 'item_id',
};

export function snapshotBusinessRows(db) {
  const ids = {};
  for (const [table, key] of Object.entries(ID_TABLES)) {
    try {
      ids[table] = db.prepare('SELECT ' + key + ' AS id FROM ' + table + ' ORDER BY 1').all().map((row) => row.id);
    } catch {
      ids[table] = [];
    }
  }
  return { counts: snapshotBusinessCounts(db), ids };
}

export function compareBusinessRows({ db, baseline = {} }) {
  const missing = [];
  const ids = baseline.ids ?? {};
  for (const [table, key] of Object.entries(ID_TABLES)) {
    for (const id of ids[table] ?? []) {
      let row = null;
      try {
        row = db.prepare('SELECT ' + key + ' AS id FROM ' + table + ' WHERE ' + key + ' = ?').get(id);
      } catch {
        row = null;
      }
      if (!row) missing.push(table + ':' + id);
    }
  }
  for (const memoryId of ids.memories ?? []) {
    try {
      const timeline = db.prepare('SELECT 1 AS ok FROM timeline WHERE memory_id = ?').get(memoryId);
      const pointer = db.prepare('SELECT 1 AS ok FROM pointers WHERE memory_id = ?').get(memoryId);
      const evidence = db.prepare('SELECT 1 AS ok FROM evidence WHERE memory_id = ? LIMIT 1').get(memoryId);
      if (!timeline || !pointer || !evidence) missing.push('memory_links:' + memoryId);
    } catch {
      missing.push('memory_links:' + memoryId);
    }
  }
  const counts = compareBusinessCounts({ db, expected: baseline.counts ?? {} });
  for (const key of counts.missing) missing.push('count:' + key);
  return { ok: missing.length === 0, missing, counts: counts.counts };
}
