import { canonicalJson } from '../identity.mjs';

/**
 * State is always replayed from the append-only relation ledger. These folds
 * are read-only; they never write a "current status" column back.
 */

const CANDIDATE_EVENTS = new Map([
  ['promote', 'promoted'],
  ['reject', 'rejected'],
  ['shelve', 'shelved'],
  ['pending', 'conflicted'],
  ['demote', 'demoted'],
  ['pending-resolve', 'promoted'],
]);

export function parsePayload(relation) {
  try {
    return JSON.parse(relation.payload);
  } catch {
    return null;
  }
}

/** Terminal states (retired / corrected) outrank superseded, which outranks active. */
export function foldMemoryState(relations, memoryId) {
  let superseded = false;
  let terminal = null;
  let terminalSeq = -1;
  for (const relation of relations) {
    const payload = parsePayload(relation);
    if (!payload) continue;
    const seq = Number(relation.commit_seq) * 1e6 + Number(relation.ordinal ?? 0);
    if (relation.type === 'supersede' && payload.oldId === memoryId) {
      superseded = true;
    } else if (
      relation.type === 'corrected' &&
      (payload.oldId === memoryId || payload.targetId === memoryId)
    ) {
      if (seq > terminalSeq) {
        terminal = 'corrected';
        terminalSeq = seq;
      }
    } else if (
      relation.type === 'demote' &&
      (payload.targetId === memoryId || payload.memoryId === memoryId)
    ) {
      if (seq > terminalSeq) {
        terminal = 'retired';
        terminalSeq = seq;
      }
    }
  }
  if (terminal) return terminal;
  return superseded ? 'superseded' : 'active';
}

export function foldCandidateStatus(relations, candidateId) {
  let status = 'pending';
  for (const relation of relations) {
    const payload = parsePayload(relation);
    if (!payload) continue;
    const target = payload.targetId ?? payload.candidateId;
    if (relation.type === 'pending-resolve') {
      if (payload.newCandidateId === candidateId) status = 'promoted';
      continue;
    }
    if (target !== candidateId) continue;
    const next = CANDIDATE_EVENTS.get(relation.type);
    if (next) status = next;
  }
  return status;
}

/** Rebuild every memory/candidate fold in one read pass. */
export function replayMain(db) {
  const relations = db
    .prepare('SELECT * FROM relations ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all();
  const memoryIds = db.prepare('SELECT id FROM memories ORDER BY id').all().map((r) => r.id);
  const candidateIds = db.prepare('SELECT id FROM candidates ORDER BY id').all().map((r) => r.id);
  const selfNoteIds = db.prepare('SELECT id FROM self_notes ORDER BY id').all().map((r) => r.id);
  const memories = new Map();
  const candidates = new Map();
  const selfNotes = new Map();
  for (const id of memoryIds) memories.set(id, foldMemoryState(relations, id));
  for (const id of candidateIds) candidates.set(id, foldCandidateStatus(relations, id));
  const notes = selfNoteStatuses(relations);
  for (const id of selfNoteIds) {
    selfNotes.set(id, notes.get(id) ?? { status: 'current', superseded_by: [] });
  }
  return { relations: relations.length, memories, candidates, selfNotes };
}

export const SUPPORTED_EVENT_VERSIONS = new Set(['1', '2']);

/** Unknown event versions are isolated and reported, never guessed. */
export function assertKnownEventVersions(relations) {
  for (const relation of relations) {
    if (!SUPPORTED_EVENT_VERSIONS.has(String(relation.event_version))) {
      const err = new Error('unsupported_event_version');
      err.code = 'unsupported_event_version';
      err.detail = { id: relation.id, eventVersion: relation.event_version };
      throw err;
    }
  }
  return true;
}

export function relationDedupeKey(type, businessKey) {
  return canonicalJson([type, businessKey]);
}

/** Self-note revision edges: supersede(oldId → newId) with targetType=self_note. */
export function foldSelfNoteBranches(relations) {
  const edges = [];
  const supersededBy = new Map();
  for (const relation of relations) {
    if (relation.type !== 'supersede') continue;
    const payload = parsePayload(relation);
    if (!payload || payload.targetType !== 'self_note') continue;
    if (typeof payload.oldId !== 'string' || typeof payload.newId !== 'string') continue;
    edges.push({
      oldId: payload.oldId,
      newId: payload.newId,
      reason: payload.reason ?? null,
      authority: payload.authority ?? null,
      oldRevision: payload.oldRevision ?? null,
      commitSeq: Number(relation.commit_seq),
      ordinal: Number(relation.ordinal ?? 0),
    });
    supersededBy.set(payload.oldId, [
      ...(supersededBy.get(payload.oldId) ?? []),
      payload.newId,
    ]);
  }
  return { edges, supersededBy };
}

/** current = note that no supersede edge points at as oldId. Forks stay current. */
export function selfNoteStatuses(relations) {
  const { supersededBy } = foldSelfNoteBranches(relations);
  const statuses = new Map();
  for (const [oldId, newIds] of supersededBy) {
    statuses.set(oldId, { status: 'superseded', superseded_by: newIds });
  }
  return statuses;
}

const VERDICT_LAYER = Object.freeze({ master: 3, self: 2, auto: 1 });

/**
 * Effective verdict: master > self > auto, then latest commit_seq/ordinal.
 * Voided verdicts are excluded; a master verdict is never overridden.
 */
export function foldJudgmentVerdicts(relations, judgmentId) {
  const voided = new Set();
  for (const relation of relations) {
    if (relation.type !== 'verdict-void') continue;
    const payload = parsePayload(relation);
    if (payload && payload.verdictId) voided.add(payload.verdictId);
  }
  let best = null;
  for (const relation of relations) {
    if (relation.type !== 'verdict') continue;
    const payload = parsePayload(relation);
    if (!payload || payload.judgmentId !== judgmentId) continue;
    if (voided.has(relation.id)) continue;
    const candidate = {
      id: relation.id,
      by: payload.by,
      result: payload.result,
      at: relation.at,
      commitSeq: Number(relation.commit_seq),
      ordinal: Number(relation.ordinal ?? 0),
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const layerDiff = (VERDICT_LAYER[candidate.by] ?? 0) - (VERDICT_LAYER[best.by] ?? 0);
    if (layerDiff > 0) best = candidate;
    else if (layerDiff === 0) {
      const newer =
        candidate.commitSeq > best.commitSeq ||
        (candidate.commitSeq === best.commitSeq && candidate.ordinal > best.ordinal);
      if (newer) best = candidate;
    }
  }
  return best;
}

const LEGACY_REQUIRED = Object.freeze({
  'due-state': ['baseRevision', 'revision', 'policyRevision', 'reportId', 'dueProjection'],
  shelve: ['targetType', 'operationId', 'reviewId'],
  'candidate-entity': ['candidateEntityId', 'observationId', 'originalBytesBase64', 'evidenceHash', 'scopeId', 'ruleRevision'],
  'review-defer': ['reviewId', 'reason', 'triggerId', 'policyRevision'],
});

/**
 * Read-only adapter for first-batch (v1) events. It never rewrites the row and
 * never fabricates a v2 event: missing fields are reported as legacy_missing.
 */
export function normalizeLegacyRelation(relation) {
  const payload = parsePayload(relation) ?? {};
  const required = LEGACY_REQUIRED[relation.type] ?? [];
  const missing = required.filter((field) => payload[field] === undefined);
  let normalized = { ...payload };
  if (relation.type === 'due-state' && payload.revision === undefined) {
    const parts = String(relation.dedupe_key ?? '').split(':');
    const tail = Number(parts[parts.length - 1]);
    if (Number.isInteger(tail)) {
      normalized = {
        ...payload,
        revision: tail,
        baseRevision: tail - 1,
        legacy_key_revision: tail,
      };
    }
  }
  return {
    relationId: relation.id,
    type: relation.type,
    eventVersion: String(relation.event_version),
    payloadVersion: String(relation.payload_version),
    missing,
    normalized,
  };
}

/** Audit legacy rows plus mention rows that never had an event. */
export function legacyAudit(db) {
  const relations = db
    .prepare('SELECT * FROM relations ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all();
  const summary = { v1: 0, v2: 0, byType: {}, legacy_missing: [], candidate_entity_row_without_event: [] };
  for (const relation of relations) {
    summary.byType[relation.type] = (summary.byType[relation.type] ?? 0) + 1;
    if (String(relation.event_version) === '2') {
      summary.v2 += 1;
      continue;
    }
    summary.v1 += 1;
    const normalized = normalizeLegacyRelation(relation);
    if (normalized.missing.length > 0) {
      summary.legacy_missing.push({
        relationId: relation.id,
        type: relation.type,
        missing: normalized.missing,
      });
    }
  }
  const mentionIds = db
    .prepare('SELECT id FROM candidate_entity_registry ORDER BY id')
    .all()
    .map((row) => row.id);
  const eventIds = new Set(
    relations
      .filter((relation) => relation.type === 'candidate-entity')
      .map((relation) => parsePayload(relation)?.candidateEntityId)
      .filter(Boolean),
  );
  for (const id of mentionIds) {
    if (!eventIds.has(id)) summary.candidate_entity_row_without_event.push(id);
  }
  return summary;
}

/** Validate that every relation carries a known event/payload version. */
export function assertKnownEventVersionsOrQuarantine(relations) {
  for (const relation of relations) {
    if (!SUPPORTED_EVENT_VERSIONS.has(String(relation.event_version))) {
      return { ok: false, quarantined: relation.id, type: relation.type, version: relation.event_version };
    }
  }
  return { ok: true };
}
