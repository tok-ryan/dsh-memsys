import { canonicalJson } from '../identity.mjs';

/**
 * Exact readback: verify the committed object by stable id against the frozen
 * payload. Missing is only returned when the authoritative store confirms the
 * row does not exist; everything else is unknown.
 */

function equalValue(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return canonicalJson(a) === canonicalJson(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

export function compareFields(row, expected, fields) {
  for (const field of fields) {
    if (!equalValue(row[field], expected[field])) {
      return { ok: false, field, actual: row[field], expected: expected[field] };
    }
  }
  return { ok: true };
}

/**
 * Read a row by stable key and compare the immutable field set.
 * Returns {status:'found'|'missing'|'unknown', ...}.
 */
export function readExact(db, { table, keyColumn = 'id', keyValue, fields, expected }) {
  let row;
  try {
    row = db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ?`).get(keyValue);
  } catch (err) {
    return { status: 'unknown', reason: 'read_error', error: err.message };
  }
  if (!row) return { status: 'missing', reason: 'absent', keyValue };
  const comparison = compareFields(row, expected, fields);
  if (!comparison.ok) {
    return {
      status: 'unknown',
      reason: 'field_mismatch',
      field: comparison.field,
      expected: comparison.expected,
      actual: comparison.actual,
    };
  }
  return { status: 'found', row };
}

export const OBSERVATION_FIELDS = Object.freeze([
  'id', 'idempotency_key', 'payload_hash', 'text', 'source', 'author_kind', 'origin', 'lossy',
  'state_snapshot', 'initial_strength',
]);

export const CANDIDATE_FIELDS = Object.freeze([
  'id', 'idempotency_key', 'payload_hash', 'observation_id', 'source_unit', 'source_path', 'text',
  'detail', 'why', 'type', 'scene', 'scope', 'tags', 'semantic_status', 'record_kind', 'origin',
  'structured_value', 'state_snapshot', 'initial_strength', 'status',
]);

export const MEMORY_FIELDS = Object.freeze([
  'id', 'idempotency_key', 'payload_hash', 'text', 'detail', 'why', 'type', 'scene', 'scope',
  'tags', 'semantic_status', 'record_kind', 'origin', 'credibility', 'lossy', 'weight',
  'state_snapshot', 'initial_strength', 'promoted_from', 'due_state', 'recorded_at',
]);

export const readExactObservation = (db, expected) =>
  readExact(db, { table: 'observations', keyValue: expected.id, fields: OBSERVATION_FIELDS, expected });

export const readExactCandidate = (db, expected) =>
  readExact(db, { table: 'candidates', keyValue: expected.id, fields: CANDIDATE_FIELDS, expected });

export const readExactMemory = (db, expected) =>
  readExact(db, { table: 'memories', keyValue: expected.id, fields: MEMORY_FIELDS, expected });

/** Memory readback also verifies timeline, pointer and the copied evidence set. */
export function readExactMemorySet(db, expected, evidenceIds = []) {
  const base = readExactMemory(db, expected);
  if (base.status !== 'found') return base;
  const timeline = db.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(expected.id);
  const pointer = db.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(expected.id);
  if (!timeline) return { status: 'unknown', reason: 'timeline_missing' };
  if (!pointer) return { status: 'unknown', reason: 'pointer_missing' };
  const rows = db
    .prepare('SELECT id FROM evidence WHERE memory_id = ? ORDER BY id')
    .all(expected.id)
    .map((row) => row.id);
  const missingEvidence = evidenceIds.filter((id) => !rows.includes(id));
  if (missingEvidence.length > 0) {
    return { status: 'unknown', reason: 'evidence_missing', missingEvidence };
  }
  return { status: 'found', row: base.row, timeline, pointer };
}
