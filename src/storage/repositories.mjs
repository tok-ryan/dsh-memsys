import { canonicalJson, sha256Hex } from '../identity.mjs';

const IDENT = /^[a-z_][a-z0-9_]*$/;

function assertIdent(name) {
  if (!IDENT.test(name)) throw new TypeError(`invalid_identifier:${name}`);
  return name;
}

/** Thin, parameterised insert helper. Table/column names come from our code only. */
export function insertRow(db, table, row) {
  assertIdent(table);
  const columns = Object.keys(row).map(assertIdent);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`;
  db.prepare(sql).run(...columns.map((column) => row[column]));
  return row;
}

export function getRow(db, table, keyColumn, keyValue) {
  assertIdent(table);
  assertIdent(keyColumn);
  return db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ?`).get(keyValue) ?? null;
}

export function allRows(db, table, where = '', params = []) {
  assertIdent(table);
  const sql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  return db.prepare(sql).all(...params);
}

export function countRows(db, table) {
  assertIdent(table);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row.n);
}

export const getObservation = (db, id) => getRow(db, 'observations', 'id', id);
export const getCandidate = (db, id) => getRow(db, 'candidates', 'id', id);
export const getMemory = (db, id) => getRow(db, 'memories', 'id', id);
export const getTimeline = (db, memoryId) => getRow(db, 'timeline', 'memory_id', memoryId);
export const getPointer = (db, memoryId) => getRow(db, 'pointers', 'memory_id', memoryId);
export const getOriginRow = (db, absolutePath, contentHash) =>
  db
    .prepare('SELECT * FROM origins WHERE path = ? AND content_hash = ?')
    .get(absolutePath, contentHash) ?? null;

export const insertObservation = (db, row) => insertRow(db, 'observations', row);
export const insertCandidate = (db, row) => insertRow(db, 'candidates', row);
export const insertMemory = (db, row) => insertRow(db, 'memories', row);
export const insertEvidence = (db, row) => insertRow(db, 'evidence', row);
export const insertTimeline = (db, row) => insertRow(db, 'timeline', row);
export const insertPointer = (db, row) => insertRow(db, 'pointers', row);
export const insertOrigin = (db, row) => insertRow(db, 'origins', row);

export function listEvidence(db, target, targetId) {
  if (target === 'candidate') {
    return db.prepare('SELECT * FROM evidence WHERE candidate_id = ? ORDER BY id').all(targetId);
  }
  if (target === 'memory') {
    return db.prepare('SELECT * FROM evidence WHERE memory_id = ? ORDER BY id').all(targetId);
  }
  throw new TypeError(`invalid_evidence_target:${target}`);
}

/**
 * Allocate the next commit sequence inside the caller's IMMEDIATE transaction.
 * Sequence is derived from the append-only relation ledger, so it survives
 * restarts without a separate counter table.
 */
export function nextCommitSeq(db) {
  const row = db.prepare('SELECT COALESCE(MAX(commit_seq), 0) + 1 AS seq FROM relations').get();
  return Number(row.seq);
}

export function insertRelation(db, relation) {
  return insertRow(db, 'relations', {
    id: relation.id,
    type: relation.type,
    payload: typeof relation.payload === 'string' ? relation.payload : canonicalJson(relation.payload),
    dedupe_key: relation.dedupeKey,
    at: relation.at,
    commit_seq: relation.commitSeq,
    ordinal: relation.ordinal ?? 0,
    event_version: relation.eventVersion ?? '1',
    payload_version: relation.payloadVersion ?? '1',
  });
}

export function listRelations(db) {
  return db
    .prepare('SELECT * FROM relations ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all();
}

export function relationsFor(db, field, value) {
  return db
    .prepare(
      `SELECT * FROM relations
       WHERE json_extract(payload, '$.${field}') = ?
       ORDER BY commit_seq ASC, ordinal ASC, id ASC`,
    )
    .all(value);
}

export function getConfigValue(db, key) {
  const row = db.prepare('SELECT key, value, revision FROM config WHERE key = ?').get(key);
  if (!row) return null;
  return { key: row.key, value: JSON.parse(row.value), revision: Number(row.revision) };
}

export function putConfigValue(db, key, value, revision) {
  const existing = getConfigValue(db, key);
  if (existing) {
    db.prepare('UPDATE config SET value = ?, revision = ? WHERE key = ?').run(
      canonicalJson(value),
      revision,
      key,
    );
  } else {
    db.prepare('INSERT INTO config (key, value, revision) VALUES (?, ?, ?)').run(
      key,
      canonicalJson(value),
      revision,
    );
  }
  return { key, value, revision };
}

export function getState(db, key) {
  const row = db.prepare('SELECT key, value, source_revision FROM state WHERE key = ?').get(key);
  if (!row) return null;
  return { key: row.key, value: JSON.parse(row.value), sourceRevision: Number(row.source_revision) };
}

export function putState(db, key, value, sourceRevision) {
  const existing = getState(db, key);
  if (existing) {
    db.prepare('UPDATE state SET value = ?, source_revision = ? WHERE key = ?').run(
      canonicalJson(value),
      sourceRevision,
      key,
    );
  } else {
    db.prepare('INSERT INTO state (key, value, source_revision) VALUES (?, ?, ?)').run(
      key,
      canonicalJson(value),
      sourceRevision,
    );
  }
  return { key, value, sourceRevision };
}

/**
 * Seed the fixed batch-1 registry projection (owner, scenes, attribute enums)
 * and record the config-change relation that produced it. No owner approval is
 * invented: the relation says "initial fixed registry", nothing more.
 */
export const INITIAL_REGISTRY = Object.freeze({
  entity_registry: [
    { id: 'entity:owner', kind: 'owner', canonical: '主人' },
    { id: 'entity:scope:work', kind: 'scope', canonical: 'work' },
    { id: 'entity:scope:life', kind: 'scope', canonical: 'life' },
    { id: 'entity:scope:global', kind: 'scope', canonical: 'global' },
  ],
  attribute_registry: [
    { id: 'food_preference', value_kind: 'entity', scopes: ['global', 'work', 'life'] },
    { id: 'residence', value_kind: 'entity', scopes: ['global', 'life'] },
    { id: 'communication_style', value_kind: 'text', scopes: ['global'] },
    { id: 'project_status', value_kind: 'text', scopes: ['work'] },
    { id: 'promise', value_kind: 'event', scopes: ['global', 'work', 'life'] },
    { id: 'event', value_kind: 'event', scopes: ['global', 'work', 'life'] },
  ],
  alias_registry: [],
  revision: '1',
  source: 'initial-fixed-registry',
});

export function seedInitialRegistry(db, clock) {
  const existing = getConfigValue(db, 'registry');
  if (existing && existing.value?.revision === '1') return existing;
  const at = clock.at().at;
  putConfigValue(db, 'registry', INITIAL_REGISTRY, 1);
  const businessKey = 'config-change:registry:1';
  insertRelation(db, {
    id: sha256Hex(canonicalJson(['main', 'config-change', businessKey])),
    type: 'config-change',
    payload: { config: 'registry', newRevision: 1, change: 'initial-fixed-registry' },
    dedupeKey: businessKey,
    at,
    commitSeq: nextCommitSeq(db),
    ordinal: 0,
  });
  return getConfigValue(db, 'registry');
}

export function getRelationByDedupe(db, dedupeKey) {
  return db.prepare('SELECT * FROM relations WHERE dedupe_key = ?').get(dedupeKey) ?? null;
}

/**
 * Append one relation event with a database-supplied id, dedupe key and
 * monotonic commit sequence. Must run inside the caller's write transaction.
 */
export function appendRelation(
  db,
  {
    type,
    payload,
    businessKey,
    at,
    ordinal = 0,
    eventVersion = '1',
    payloadVersion = '1',
    strict = true,
    keyEncoding = 'legacy',
  },
) {
  const dedupeKey =
    keyEncoding === 'canonical' ? canonicalJson([type, businessKey]) : `${type}:${businessKey}`;
  const existing = getRelationByDedupe(db, dedupeKey);
  if (existing) {
    if (strict) {
      const samePayload = canonicalJson(JSON.parse(existing.payload)) === canonicalJson(payload);
      const sameVersion =
        String(existing.event_version) === String(eventVersion) &&
        String(existing.payload_version) === String(payloadVersion);
      if (!samePayload || !sameVersion) {
        const err = new Error('idempotency_conflict');
        err.code = 'idempotency_conflict';
        err.detail = { dedupeKey, existingId: existing.id };
        throw err;
      }
    }
    return { id: existing.id, commitSeq: Number(existing.commit_seq), replayed: true };
  }
  const id = sha256Hex(canonicalJson(['main', type, dedupeKey]));
  const commitSeq = nextCommitSeq(db);
  insertRelation(db, {
    id,
    type,
    payload,
    dedupeKey,
    at,
    commitSeq,
    ordinal,
    eventVersion,
    payloadVersion,
  });
  return { id, commitSeq, replayed: false, dedupeKey };
}

export function listCandidatesByStatus(db, status) {
  return db.prepare('SELECT * FROM candidates WHERE status = ? ORDER BY created_input_seq, id').all(status);
}

export function listCandidatesByObservation(db, observationId) {
  return db.prepare('SELECT * FROM candidates WHERE observation_id = ? ORDER BY id').all(observationId);
}

export function getCandidateByKey(db, idempotencyKey) {
  return db.prepare('SELECT * FROM candidates WHERE idempotency_key = ?').get(idempotencyKey) ?? null;
}

export function getMemoryByBusinessKey(db, idempotencyKey) {
  return db.prepare('SELECT * FROM memories WHERE idempotency_key = ?').get(idempotencyKey) ?? null;
}

export function insertReviewQueue(db, row) {
  return insertRow(db, 'review_queue', row);
}

export function getReviewQueue(db, id) {
  return getRow(db, 'review_queue', 'id', id);
}

export function getReviewQueueByObject(db, kind, objectId) {
  return (
    db
      .prepare('SELECT * FROM review_queue WHERE object_kind = ? AND object_id = ?')
      .get(kind, objectId) ?? null
  );
}

export function closeReviewQueue(db, id, reason, at) {
  db.prepare(
    'UPDATE review_queue SET status = ?, close_reason = ?, updated_at = ? WHERE id = ?',
  ).run('closed', reason, at, id);
}

export function openReviewQueue(db, status = 'open') {
  return db
    .prepare('SELECT * FROM review_queue WHERE status = ? ORDER BY created_input_seq, id')
    .all(status);
}

export function insertDueQueue(db, row) {
  return insertRow(db, 'due_queue', row);
}

export function getDueQueue(db, memoryId) {
  return getRow(db, 'due_queue', 'memory_id', memoryId);
}

export function listDueQueue(db, dueState) {
  return db
    .prepare('SELECT * FROM due_queue WHERE due_state = ? ORDER BY enqueued_seq ASC, memory_id ASC')
    .all(dueState);
}

export function updateDueQueueState(db, memoryId, dueState, revision, reason) {
  db.prepare(
    'UPDATE due_queue SET due_state = ?, revision = ?, reason = ? WHERE memory_id = ?',
  ).run(dueState, revision, reason ?? null, memoryId);
}

export function insertCandidateEntity(db, row) {
  return insertRow(db, 'candidate_entity_registry', row);
}

export function listCandidateEntities(db, observationId) {
  return db
    .prepare('SELECT * FROM candidate_entity_registry WHERE observation_id = ? ORDER BY id')
    .all(observationId);
}

export function listMemoriesByTopic(db, topicKey) {
  return db.prepare('SELECT * FROM memories WHERE topic_key = ? ORDER BY recorded_at, id').all(topicKey);
}

export function findCandidateEntity(db, id) {
  return getRow(db, 'candidate_entity_registry', 'id', id);
}

export const getSelfNote = (db, id) => getRow(db, 'self_notes', 'id', id);

export function getSelfNoteByKey(db, idempotencyKey) {
  return db.prepare('SELECT * FROM self_notes WHERE idempotency_key = ?').get(idempotencyKey) ?? null;
}

export function insertSelfNote(db, row) {
  return insertRow(db, 'self_notes', row);
}

export function listSelfNotes(db) {
  return db.prepare('SELECT * FROM self_notes ORDER BY at ASC, id ASC').all();
}

export function listRelationsByType(db, type) {
  return db
    .prepare('SELECT * FROM relations WHERE type = ? ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all(type);
}
