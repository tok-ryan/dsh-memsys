import { createHash } from 'node:crypto';

/** Full-length SHA-256 over UTF-8 bytes (or a Buffer as-is). */
export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Canonical JSON: fixed key order (sorted), original strings, arrays in the
 * order given by the caller (evidence sets must be sorted by the caller).
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number');
    return JSON.stringify(value);
  }
  if (type === 'string') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`unsupported_type:${type}`);
}

export function payloadHash(value) {
  return sha256Hex(canonicalJson(value));
}

/** Object id = type prefix + SHA-256 of the complete business key. */
export function objectId(prefix, businessKey) {
  return `${prefix}_${sha256Hex(businessKey)}`;
}

/** Event id = SHA-256([database label, type, business key]). */
export function eventId(dbLabel, type, businessKey) {
  return sha256Hex(canonicalJson([dbLabel, type, businessKey]));
}

/** Controlled-operation object key = target database + logical object id. */
export function objectKey(targetDb, logicalId) {
  return `${targetDb}:${logicalId}`;
}

/** Stream key for compiled injections: mode + session + stream, never a revision. */
export function compileStreamKey(mode, sessionId) {
  return `${mode}:${sessionId}:inject-stream`;
}

export const keys = Object.freeze({
  observationConversation: (identity, sessionId, messageSeq) =>
    `obs:conversation:${identity}:${sessionId}:${messageSeq}`,
  observationTool: (sessionId, callId) => `obs:tool:${sessionId}:${callId}`,
  observationFile: (absolutePath, contentHash, span) =>
    `obs:file:${sha256Hex(canonicalJson([absolutePath, contentHash, span]))}`,
  observationModel: (sessionId, callId, slot) => `obs:model:${sessionId}:${callId}:${slot}`,
  capture: (observationId, sourceUnit) => `capture:${observationId}:${sourceUnit}`,
  quote: (observationId) => `quote:${observationId}:command_body`,
  proposal: (observationId, sourceUnit, semanticPayload) =>
    `proposal:${sha256Hex(canonicalJson([observationId, sourceUnit, semanticPayload]))}`,
  resolve: (pendingId) => `resolve:${pendingId}`,
  coexist: (pendingId) => `coexist:${pendingId}`,
  merge: (orderedIds, versions) =>
    `merge:${sha256Hex(canonicalJson([[...orderedIds].sort(), versions]))}`,
  promote: (candidateId) => `promote:${candidateId}`,
  kind: (callId, slot) => `kind:${callId}:${slot}`,
  compile: (sessionId, roundId, sourceRevision, policyRevision) =>
    `compile:${sessionId}:${roundId}:${sourceRevision}:${policyRevision}`,
});

/** Detect a same-hash/different-key collision; never merge silently. */
export function assertNoCollision(seen, key, id) {
  const previous = seen.get(id);
  if (previous !== undefined && previous !== key) {
    const err = new Error('hash_collision');
    err.code = 'hash_collision';
    err.detail = { id, previousKey: previous, key };
    throw err;
  }
  seen.set(id, key);
}

/** Normalise a `bytes:start:end` span (UTF-8 byte half-open interval). */
export function parseSourceSpan(span) {
  if (typeof span !== 'string') throw new TypeError('invalid_source_span');
  const match = /^bytes:(\d+):(\d+)$/.exec(span);
  if (!match) throw new TypeError('invalid_source_span');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    throw new TypeError('invalid_source_span');
  }
  return { start, end };
}

export function formatSourceSpan(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new TypeError('invalid_source_span');
  }
  return `bytes:${start}:${end}`;
}

export const OBJECT_PREFIXES = Object.freeze({
  observation: 'obs',
  candidate: 'cand',
  memory: 'mem',
  self_note: 'sn',
  judgment: 'jdg',
  speculation: 'spec',
  project: 'proj',
});

/** <kind>:<stable callId>:<slot> — kind is part of the identity on purpose. */
export function kindBusinessKey(kind, callId, slot) {
  return `${kind}:${callId}:${slot}`;
}
