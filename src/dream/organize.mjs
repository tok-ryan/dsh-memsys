import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getMemory,
  insertCandidate,
  insertEvidence,
  insertObservation,
} from '../storage/repositories.mjs';
import { promoteInTransaction } from '../write/promote.mjs';
import { foldMemoryState } from '../storage/replay.mjs';
import { listRelations } from '../storage/repositories.mjs';
import { assertDreamRole } from './store.mjs';
import { modelOrigin } from '../write/authority.mjs';
import { WriteError } from '../write/authority.mjs';

const COMPARED = [
  'text', 'detail', 'why', 'type', 'scene', 'scope', 'tags', 'structured_value',
  'topic_key', 'credibility', 'due_state',
  'start_at', 'end_at', 'prec_start', 'prec_end', 'time_state',
  'weight', 'pointer_status', 'pointer_location', 'pointer_search_hint',
  'judgment_id', 'origin', 'semantic_status', 'record_kind',
  'key_status', 'binding_status', 'binding_basis',
];

function loadMerged(main, ids) {
  return ids.map((id) => {
    const memory = getMemory(main, id);
    if (!memory) throw new WriteError('validation_error', { field: 'ids', id, reason: 'missing' });
    return memory;
  });
}

function dueDeadline(main, memoryId) {
  const queue = main.prepare('SELECT deadline_at FROM due_queue WHERE memory_id = ?').get(memoryId);
  return queue?.deadline_at ?? null;
}

/**
 * Mechanical exact merge only: no similarity, no NFKC, no negation stripping.
 * Endpoints must be active, resolved and accepted; dream-linked rows only yield a
 * suggestion (mechanical merge must not wash a dream chain).
 */
export function mergeExact(deps, { runtime, ids }) {
  assertDreamRole(runtime);
  const { main, clock } = deps;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 8) {
    throw new WriteError('validation_error', { field: 'ids' });
  }
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new WriteError('validation_error', { field: 'ids', reason: 'duplicate' });
  const memories = loadMerged(main, unique);
  const relations = listRelations(main);
  for (const memory of memories) {
    if (foldMemoryState(relations, memory.id) !== 'active') {
      throw new WriteError('inactive_fact', { memoryId: memory.id, state: foldMemoryState(relations, memory.id) });
    }
  }
  for (const memory of memories) {
    if (['open', 'pending-due', 'pending-done', 'cooled-due', 'shelved-due'].includes(memory.due_state)) {
      throw new WriteError('blocked_by_due_state', { memoryId: memory.id, dueState: memory.due_state });
    }
    if (memory.key_status !== 'resolved') throw new WriteError('unresolved_forbidden', { memoryId: memory.id });
    if (memory.binding_status !== 'accepted') throw new WriteError('binding_not_accepted', { memoryId: memory.id });
  }
  const first = memories[0];
  const firstTimeline = main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(first.id) ?? {};
  const firstPointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(first.id) ?? {};
  for (const memory of memories) {
    const timeline = main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(memory.id) ?? {};
    const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memory.id) ?? {};
    for (const field of ['start_at', 'end_at', 'prec_start', 'prec_end', 'time_state']) {
      if (canonicalJson(timeline[field] ?? null) !== canonicalJson(firstTimeline[field] ?? null)) {
        throw new WriteError('validation_error', { field: 'timeline.' + field, reason: 'not_exact' });
      }
    }
    for (const field of ['status', 'location', 'search_hint', 'lossy']) {
      if (canonicalJson(pointer[field] ?? null) !== canonicalJson(firstPointer[field] ?? null)) {
        throw new WriteError('validation_error', { field: 'pointer.' + field, reason: 'not_exact' });
      }
    }
    for (const field of COMPARED) {
      if (canonicalJson(memory[field] ?? null) !== canonicalJson(first[field] ?? null)) {
        throw new WriteError('validation_error', { field, reason: 'not_exact' });
      }
    }
    if (dueDeadline(main, memory.id) !== dueDeadline(main, first.id)) {
      throw new WriteError('validation_error', { field: 'due_deadline', reason: 'not_exact' });
    }
    if (String(memory.origin).includes('#p')) {
      return { ok: false, code: 'suggestion_only', reason: 'dream_linked_input', memoryId: memory.id };
    }
  }

  const mergeKey = payloadHash({ merge: memories.map((memory) => [memory.id, memory.payload_hash]).sort() });
  const candidateId = objectId('cand', `merge:${mergeKey}`);
  const observationId = objectId('obs', `merge:${mergeKey}`);
  const at = clock.at().at;
  const evidence = memories.map((memory) => ({
    id: objectId('ev', `merge:${mergeKey}:${memory.id}`),
    memory_id: null,
    candidate_id: candidateId,
    observation_id: null,
    source_memory_id: memory.id,
    role: 'basis',
    source_span: `bytes:0:${Buffer.byteLength(memory.text, 'utf8')}`,
    at,
  }));
  const candidate = {
    id: candidateId,
    idempotency_key: `merge:${mergeKey}`,
    at,
    payload_hash: payloadHash({ mergeKey, ids: memories.map((memory) => memory.id) }),
    observation_id: observationId,
    source_unit: `merge:${mergeKey}`,
    source_path: 'resolve',
    text: first.text,
    detail: first.detail ?? null,
    why: first.why,
    type: first.type,
    scene: first.scene,
    scope: first.scope,
    tags: first.tags,
    topic_key: first.topic_key,
    topic_components: first.topic_components ?? null,
    registry_revision: first.registry_revision ?? null,
    structured_value: first.structured_value ?? null,
    semantic_status: first.semantic_status,
    record_kind: first.record_kind,
    origin: first.origin,
    confidence: 0.5,
    lossy: 0,
    start_at: firstTimeline.start_at ?? null,
    end_at: firstTimeline.end_at ?? null,
    prec_start: firstTimeline.prec_start ?? 'unknown',
    prec_end: firstTimeline.prec_end ?? 'unknown',
    time_state: firstTimeline.time_state ?? 'point',
    due_at: first.due_at ?? null,
    weight: first.weight,
    pointer_status: firstPointer.status ?? 'unknown',
    pointer_location: firstPointer.location ?? null,
    pointer_search_hint: firstPointer.search_hint ?? null,
    judgment_id: first.judgment_id ?? null,
    creator_session_id: runtime.sessionId,
    owner_touched: 0,
    reason: 'exact_merge',
    resolved_from: canonicalJson(memories.map((memory) => memory.id)),
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
    initial_strength: initialStrength(),
    status: 'pending',
    promoted_at: null,
    rejected_reason: null,
    review_policy: 'candidate-v1',
    policy_revision: '1',
    deadline_at: null,
    created_input_seq: 0,
    recorded_at: at,
    key_status: 'resolved',
    binding_status: 'accepted',
    binding_basis: first.binding_basis,
    origin_mode: 'self',
  };
  let returnStorage = null;
  withImmediate(main, () => {
    insertObservation(main, {
      id: observationId,
      idempotency_key: `obs:merge:${mergeKey}`,
      at,
      payload_hash: payloadHash({ mergeKey }),
      text: first.text,
      source: 'model',
      author_kind: 'model',
      runtime_refs: JSON.stringify({ sessionId: runtime.sessionId, callId: runtime.callId }),
      origin: modelOrigin(runtime),
      lossy: 0,
      state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
      initial_strength: initialStrength(),
      recorded_at: at,
    });
    insertCandidate(main, candidate);
    for (const row of evidence) insertEvidence(main, row);
    promoteInTransaction(main, { candidate, runtime, clock });
    const mergedMemory = main.prepare('SELECT id FROM memories WHERE idempotency_key = ?').get(`promote:${candidateId}`);
    for (const memory of memories) {
      appendRelation(main, {
        type: 'supersede',
        payload: { oldId: memory.id, newId: mergedMemory?.id ?? null, candidateId, reason: 'exact_merge' },
        businessKey: canonicalJson([memory.id, mergedMemory?.id ?? candidateId]),
        at,
        keyEncoding: 'canonical',
        eventVersion: '2',
        payloadVersion: '2',
      });
    }
    returnStorage = mergedMemory?.id ?? null;
  });
  return { ok: true, candidateId, memoryId: returnStorage ?? null, merged: memories.length };
}

/** Supersede proposal is stored but never executed without an owner executor. */
export function supersedeProposal(deps, { runtime, oldMemoryId, newMemoryId, reason }) {
  assertDreamRole(runtime);
  const { main, clock } = deps;
  const oldMemory = getMemory(main, oldMemoryId);
  const newMemory = getMemory(main, newMemoryId);
  if (!oldMemory || !newMemory) return { ok: false, code: 'memory_missing' };
  if (oldMemory.text === newMemory.text && oldMemory.weight === newMemory.weight) {
    return { ok: false, code: 'not_a_supersede', reason: 'same_content' };
  }
  const proposalId = objectId('sup', canonicalJson([oldMemoryId, newMemoryId, reason ?? null]));
  appendRelation(main, {
    type: 'supersede-proposal',
    payload: { proposalId, oldMemoryId, newMemoryId, reason: reason ?? null, state: 'pending' },
    businessKey: proposalId,
    at: clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  return {
    ok: false,
    code: 'action_execution_unavailable',
    proposalId,
    state: 'pending',
    reason: 'no_owner_supersede_executor',
  };
}
