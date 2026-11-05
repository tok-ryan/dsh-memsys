import { objectId, keys } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import {
  appendRelation,
  getMemoryByBusinessKey,
  insertEvidence,
  insertMemory,
  insertPointer,
  insertTimeline,
  listEvidence,
} from '../storage/repositories.mjs';
import { credibilityOf } from './origin.mjs';
import { enforcePendingDueCap, registerDueOnPromote } from './due.mjs';

export const PROMOTE_STEPS = Object.freeze([
  'memories',
  'timeline',
  'pointers',
  'memory-evidence',
  'candidate-status',
  'promote-event',
]);

function buildMemoryRow(db, candidate, runtime, clock, origin = null) {
  const businessKey = keys.promote(candidate.id);
  const at = clock.at().at;
  const memoryOrigin = origin ?? candidate.origin;
  return {
    id: objectId('mem', businessKey),
    idempotency_key: businessKey,
    at,
    payload_hash: candidate.payload_hash,
    text: candidate.text,
    detail: candidate.detail,
    why: candidate.why,
    type: candidate.type,
    scene: candidate.scene,
    scope: candidate.scope,
    tags: candidate.tags,
    topic_key: candidate.topic_key,
    topic_components: candidate.topic_components,
    registry_revision: candidate.registry_revision,
    structured_value: candidate.structured_value,
    semantic_status: candidate.semantic_status,
    record_kind: candidate.record_kind,
    origin: memoryOrigin,
    credibility: credibilityOf(db, memoryOrigin),
    lossy: candidate.lossy,
    judgment_id: candidate.judgment_id,
    key_status: candidate.key_status,
    binding_status: candidate.binding_status,
    binding_basis: candidate.binding_basis,
    origin_mode: candidate.origin_mode,
    weight: candidate.weight,
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
    initial_strength: initialStrength(),
    recorded_at: at,
    promoted_from: candidate.id,
    due_state: 'none',
    due_done_at: null,
    last_touched_at: at,
  };
}

/**
 * The six-step promotion, always executed inside one main-database transaction:
 * memories → timeline → pointers → memory evidence → candidate status → event.
 * `hooks.beforeStep(i)` exists only as a test seam for rollback proofs.
 */
export function promoteInTransaction(db, { candidate, runtime, clock, hooks = {}, origin = null }) {
  const businessKey = keys.promote(candidate.id);
  const existing = getMemoryByBusinessKey(db, businessKey);
  if (existing) {
    return { memory: existing, replayed: true, steps: [], dueState: existing.due_state };
  }
  if (candidate.time_state === 'exact' && (!candidate.start_at || !candidate.end_at)) {
    throw Object.assign(new Error('exact_time_requires_both_ends'), { code: 'validation_error' });
  }
  if (candidate.pointer_status === 'exact' && !candidate.pointer_location) {
    throw Object.assign(new Error('exact_pointer_requires_location'), { code: 'validation_error' });
  }

  const at = clock.at().at;
  const memory = buildMemoryRow(db, candidate, runtime, clock, origin);
  const memoryId = memory.id;

  const steps = [
    () => {
      insertMemory(db, memory);
    },
    () => {
      insertTimeline(db, {
        memory_id: memoryId,
        start_at: candidate.start_at,
        end_at: candidate.end_at,
        prec_start: candidate.prec_start ?? 'unknown',
        prec_end: candidate.prec_end ?? 'unknown',
        time_state: candidate.time_state,
        revision: 1,
      });
    },
    () => {
      insertPointer(db, {
        memory_id: memoryId,
        status: candidate.pointer_status,
        location: candidate.pointer_location,
        search_hint: candidate.pointer_search_hint,
        lossy: candidate.lossy,
        revision: 1,
      });
    },
    () => {
      const rows = listEvidence(db, 'candidate', candidate.id);
      for (const row of rows) {
        insertEvidence(db, {
          id: objectId('ev', `${memoryId}:${row.id}`),
          memory_id: memoryId,
          candidate_id: null,
          observation_id: row.observation_id,
          source_memory_id: row.source_memory_id,
          role: row.role,
          source_span: row.source_span,
          at,
        });
      }
    },
    () => {
      db.prepare('UPDATE candidates SET status = ?, promoted_at = ? WHERE id = ?').run(
        'promoted',
        at,
        candidate.id,
      );
    },
    () => {
      const event = appendRelation(db, {
        type: 'promote',
        payload: {
          candidateId: candidate.id,
          memoryId,
          by: runtime.role,
          candidateOrigin: candidate.origin,
          ruleRevision: '1',
        },
        businessKey: candidate.id,
        at,
      });
      memory.promote_seq = event.commitSeq;
    },
  ];

  for (let index = 0; index < steps.length; index += 1) {
    if (typeof hooks.beforeStep === 'function') hooks.beforeStep(index, PROMOTE_STEPS[index]);
    steps[index]();
  }

  const dueState = registerDueOnPromote(db, {
    memoryId,
    memory,
    candidate,
    at,
    commitSeq: memory.promote_seq ?? 0,
  });
  enforcePendingDueCap(db, { identity: runtime.identity, at });

  const stored = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
  return { memory: stored, replayed: false, steps: [...PROMOTE_STEPS], dueState };
}
