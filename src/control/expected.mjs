import { payloadHash } from '../identity.mjs';

/**
 * One shared judgement for observation/candidate expectations. Recovery,
 * historical recheck and the normal commit all call this; none of them may
 * accept "the row still exists" as proof.
 */
export function verifyExpected(kind, expected, actual) {
  if (!expected || expected.kind !== kind) {
    return { ok: false, reason: 'expected_kind_mismatch' };
  }
  if (!actual || !actual.row) return { ok: false, reason: 'actual_missing' };
  if (kind !== 'due' && actual.row.payload_hash !== expected.payloadHash) {
    return { ok: false, reason: 'expected_payload_hash_mismatch' };
  }
  if (kind === 'observation') {
    if (expected.canonicalHash) {
      const canonicalHash = payloadHash({
        text: actual.row.text,
        source: actual.row.source,
        authorKind: actual.row.author_kind,
        origin: actual.row.origin,
      });
      if (canonicalHash !== expected.canonicalHash) {
        return { ok: false, reason: 'expected_canonical_mismatch' };
      }
    }
    return { ok: true };
  }
  if (kind === 'promote') {
    const projection = payloadHash({
      id: actual.row.id,
      text: actual.row.text,
      scene: actual.row.scene,
      scope: actual.row.scope,
      semantic_status: actual.row.semantic_status,
      credibility: actual.row.credibility,
      due_state: actual.row.due_state,
      topic_key: actual.row.topic_key,
    });
    if (projection !== expected.projectionHash) {
      return { ok: false, reason: 'expected_projection_mismatch' };
    }
    const actualEvents = new Set((actual.events ?? []).map((event) => `${event.type}:${event.key}`));
    for (const event of expected.events ?? []) {
      if (!actualEvents.has(`${event.type}:${event.key}`)) {
        return { ok: false, reason: `expected_event_missing:${event.type}` };
      }
    }
    return { ok: true };
  }
  if (kind === 'due') {
    const actualEvents = new Set((actual.events ?? []).map((event) => event.hash));
    if (!actualEvents.has(expected.payloadHash)) {
      return { ok: false, reason: 'expected_due_event_mismatch' };
    }
    return { ok: true };
  }
  if (kind === 'candidate') {
    const actualEvents = new Set((actual.events ?? []).map((event) => `${event.type}:${event.key}`));
    for (const event of expected.events ?? []) {
      if (!actualEvents.has(`${event.type}:${event.key}`)) {
        return { ok: false, reason: `expected_event_missing:${event.type}` };
      }
    }
    return { ok: true };
  }
  return { ok: false, reason: 'expected_kind_unsupported' };
}

export function expectedEvent(type, key) {
  return { type, key };
}
