import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactCandidate, readExactMemorySet, readExactObservation } from '../control/readback.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getCandidate,
  getMemory,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertObservation,
  listEvidence,
  nextCommitSeq,
} from '../storage/repositories.mjs';
import { consumeReceipt, revalidateReceipt, verifyReceipt, verifyReceiptBound } from '../write/owner-actions.mjs';
import { promoteInTransaction } from '../write/promote.mjs';
import { resolveTopic } from '../write/topic.mjs';
import { modelOrigin, WriteError } from '../write/authority.mjs';
import { appendDreamRelation } from './store.mjs';

export function dreamConfirmPayload({
  dreamId,
  propositionId,
  textHash,
  candidateDraft,
  evidenceRefs = [],
  path = 'owner_assertion',
  ownerObservationId = null,
}) {
  return {
    action: 'confirm-dream',
    dreamId,
    propositionId,
    textHash,
    candidateDraft,
    evidenceRefs,
    path,
    ownerObservationId,
  };
}

export function dreamConfirmPayloadHash(fields) {
  return payloadHash(dreamConfirmPayload(fields));
}

export function unconfirmDreamPayload({ confirmId, memoryId, propositionId, dreamId }) {
  return { action: 'unconfirm-dream', confirmId, memoryId, propositionId, dreamId };
}

export function unconfirmDreamPayloadHash(fields) {
  return payloadHash(unconfirmDreamPayload(fields));
}

export function voidDreamPayload({ dreamId, reason = 'owner_void' }) {
  return { action: 'void-dream', dreamId, reason };
}

export function voidDreamPayloadHash(fields) {
  return payloadHash(voidDreamPayload(fields));
}

function findProposition(dream, dreamId, propositionId) {
  return dream
    .prepare('SELECT * FROM propositions WHERE id = ? AND dream_id = ?')
    .get(propositionId, dreamId);
}

/**
 * Owner confirmation chain: dream confirm+snapshot first, then a main-library
 * proposition observation, then a confirm candidate and the existing six steps.
 */
export function confirmDream(deps, {
  receiptId,
  dreamId,
  propositionId,
  textHash,
  candidateDraft,
  evidenceRefs = [],
  path = 'owner_assertion',
  ownerObservationId = null,
}) {
  const { main, dream, control, clock } = deps;
  const proposition = findProposition(dream, dreamId, propositionId);
  if (!proposition) return { ok: false, code: 'proposition_missing' };
  if (proposition.text_hash !== textHash) return { ok: false, code: 'proposition_hash_mismatch' };
  const verified = verifyReceiptBound(main, {
    receiptId,
    action: 'confirm-dream',
    targetIds: [dreamId],
    payload: dreamConfirmPayload({
      dreamId,
      propositionId,
      textHash,
      candidateDraft,
      evidenceRefs,
      path,
      ownerObservationId,
    }),
    baseVersions: [proposition.text_hash],
  });
  if (!verified.ok) return verified;
  const dreamRow = dream.prepare('SELECT * FROM dreams WHERE id = ?').get(dreamId);
  if (!dreamRow) return { ok: false, code: 'dream_missing' };

  const draft = candidateDraft ?? {};
  for (const field of ['text', 'why', 'type', 'scene', 'scope']) {
    if (typeof draft[field] !== 'string' || draft[field].length === 0) {
      return { ok: false, code: 'validation_error', field: `candidateDraft.${field}` };
    }
  }
  if (!draft.components) return { ok: false, code: 'validation_error', field: 'candidateDraft.components' };
  const scopeId = draft.scope === 'life-only' ? 'life' : draft.scope === 'global' ? 'global' : 'work';
  const topic = resolveTopic(main, draft.components, {
    scopeId,
    observationId: propositionId,
    sourceUnit: 'confirm',
  });
  if (topic.keyStatus !== 'resolved') return { ok: false, code: 'unresolved_forbidden' };
  if (!ownerObservationId) return { ok: false, code: 'validation_error', field: 'ownerObservationId' };

  const confirmId = objectId('dcf', canonicalJson([dreamId, propositionId, textHash, receiptId]));
  const at = clock.at().at;
  const candidateId = objectId('cand', `confirm:${confirmId}`);
  const snapshotPayload = {
    confirmId,
    dreamId,
    propositionId,
    textHash,
    propositionText: proposition.text,
    sourceUnit: propositionId,
    sourcePath: 'confirm',
    candidateDraft: {
      id: candidateId,
      text: draft.text,
      detail: draft.detail ?? null,
      why: draft.why,
      type: draft.type,
      scene: draft.scene,
      scope: draft.scope,
      topicKey: topic.topicKey,
      topicComponents: topic.components,
      registryRevision: topic.registryRevision,
      semanticStatus: 'accepted',
      recordKind: draft.recordKind ?? 'assertion',
      originMode: 'inherited',
      bindingStatus: 'accepted',
      keyStatus: topic.keyStatus,
      tags: draft.tags ?? [],
      weight: draft.weight ?? 5,
      structuredValue: draft.structuredValue !== undefined ? draft.structuredValue : null,
      startAt: draft.startAt ?? null,
      endAt: draft.endAt ?? null,
      precStart: draft.precStart ?? 'unknown',
      precEnd: draft.precEnd ?? 'unknown',
      timeState: draft.timeState ?? 'point',
      dueAt: draft.dueAt ?? null,
      pointerStatus: draft.pointerStatus ?? 'unknown',
      pointerLocation: draft.pointerLocation ?? null,
      pointerSearchHint: draft.pointerSearchHint ?? null,
      judgmentId: draft.judgmentId ?? null,
    },
    evidence_refs: evidenceRefs,
    evidence_snapshot: [
      { ref: `obs:dream:${propositionId}:${textHash}`, hash: payloadHash(proposition.text), role: 'proposition' },
      ...evidenceRefs.map((ref) => ({ ref, hash: payloadHash(ref), role: 'provided' })),
    ],
    original_session_id: dreamRow.author_runtime,
    owner_observation_id: ownerObservationId,
    approval_receipt_id: receiptId,
    confirmation_basis: path,
    deferred_generated: ['memory.recorded_at', 'memory.last_touched_at', 'memory.state_snapshot'],
    promotion_targets: ['memories', 'timeline', 'pointers', 'evidence', 'candidate-status', 'promote-event'],
  };
  const snapshotHash = payloadHash(snapshotPayload);

  // 0) Persist the resumable intent (with the frozen topic) BEFORE consuming the
  // receipt; a crash after dream commit can then be replayed without re-resolving.
  const plan = {
    confirmId,
    dreamId,
    propositionId,
    propositionText: proposition.text,
    propositionOrdinal: proposition.ordinal,
    textHash,
    candidateId,
    snapshotHash,
    receiptId,
    candidateDraft: draft,
    evidenceRefs,
    path,
    ownerObservationId,
    topicKey: topic.topicKey,
    topicComponents: topic.components,
    registryRevision: topic.registryRevision,
    scopeId,
  };
  appendRelation(main, {
    type: 'dream-confirm-task',
    payload: { ...plan, stage: 'intent' },
    businessKey: confirmId + ':intent',
    at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });

  // 1) Dream library transaction: confirm event + full snapshot.
  const dreamReceipt = commitControlled({
    control,
    clock,
    spec: {
      objectKey: `dream:${confirmId}`,
      targetDb: 'dream',
      requestKey: `dream-confirm:${confirmId}`,
      payloadHash: payloadHash({ confirmId, propositionId, textHash, snapshotHash }),
      immutablePayload: canonicalJson({ confirmId, propositionId, textHash, snapshotHash }),
      targetIds: [dreamId, propositionId],
      hooks: deps.commitHooks ?? {},
    },
    writeTxn: () =>
      withImmediate(dream, () => {
        appendDreamRelation(dream, clock, {
          type: 'confirm',
          payload: {
            confirmId,
            dreamId,
            propositionId,
            textHash,
            path,
            receiptId,
            memoryId: null,
            evidence_refs: evidenceRefs,
            snapshotHash,
          },
          businessKey: confirmId,
          at,
        });
        dream
          .prepare(
            `INSERT INTO confirmation_snapshots
               (id, confirm_id, dream_id, proposition_id, payload, payload_hash, approval_receipt_id, original_session_id, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `snapshot:${confirmId}`, confirmId, dreamId, propositionId,
            canonicalJson(snapshotPayload), snapshotHash, receiptId,
            dreamRow.author_runtime, at,
          );
      }),
    readExact: () => {
      const confirm = dream
        .prepare("SELECT * FROM relations WHERE type = 'confirm' AND dedupe_key = ?")
        .get(canonicalJson(['confirm', confirmId]));
      const snapshot = dream.prepare('SELECT * FROM confirmation_snapshots WHERE confirm_id = ?').get(confirmId);
      if (!confirm || !snapshot) return { status: 'missing', reason: 'confirm_snapshot_incomplete' };
      return { status: 'found', row: snapshot };
    },
  });
  if (dreamReceipt.status !== 'found') {
    return { ok: false, code: dreamReceipt.readback?.reason ?? 'dream_confirm_failed' };
  }
  const gate = withImmediate(main, () =>
    revalidateReceipt(main, clock, {
      receiptId,
      action: 'confirm-dream',
      targetIds: [dreamId],
      payload: dreamConfirmPayload({
        dreamId,
        propositionId,
        textHash,
        candidateDraft,
        evidenceRefs,
        path,
        ownerObservationId,
      }),
      baseVersions: [textHash],
    }),
  );
  if (!gate.ok) return { ok: false, code: gate.code };

  // 2) Persist the cross-library plan, then run the main steps (resumable).
  appendRelation(main, {
    type: 'dream-confirm-task',
    payload: { ...plan, stage: 'main_pending' },
    businessKey: confirmId,
    at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  const completed = completeDreamConfirmMain({ main, control, clock }, plan, { hooks: deps.commitHooks ?? {} });
  if (completed.ok) {
    appendRelation(main, {
      type: 'dream-confirm-task',
      payload: { confirmId, stage: 'done' },
      businessKey: confirmId + ':done',
      at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
  }
  return completed;
}

/** Shared main-side steps; safe to resume once the dream confirm is durable. */
export function completeDreamConfirmMain({ main, control, clock }, plan, options = {}) {
  const { confirmId, dreamId, propositionId, propositionText, propositionOrdinal, textHash, candidateId, snapshotHash, receiptId, candidateDraft: draft, evidenceRefs, path, ownerObservationId } = plan;
  const at = clock.at().at;
  const scopeId = draft.scope === 'life-only' ? 'life' : draft.scope === 'global' ? 'global' : 'work';
  const topic = plan.topicKey
    ? {
        topicKey: plan.topicKey,
        components: plan.topicComponents ?? draft.components,
        registryRevision: plan.registryRevision ?? null,
        keyStatus: 'resolved',
      }
    : resolveTopic(main, draft.components, {
        scopeId,
        observationId: propositionId,
        sourceUnit: 'confirm',
      });
  if (topic.keyStatus !== 'resolved') return { ok: false, code: 'unresolved_forbidden' };
  const obsBusinessKey = `obs:dream:${propositionId}:${textHash}`;
  const observationId = objectId('obs', obsBusinessKey);
  if (!getObservation(main, observationId)) {
    const origin = canonicalJson([...new Set([`${dreamId}#p${propositionOrdinal}`, modelOrigin({ sessionId: 'dream', callId: confirmId, identity: 'owner' })])].sort());
    const observationRow = {
      id: observationId,
      idempotency_key: obsBusinessKey,
      at,
      payload_hash: payloadHash({ text: propositionText, source: 'dream', authorKind: 'model', origin }),
      text: propositionText,
      source: 'dream',
      author_kind: 'model',
      runtime_refs: JSON.stringify({ dreamId, propositionId }),
      origin,
      lossy: 0,
      state_snapshot: JSON.stringify(buildStateSnapshot({ runtime: { phase: 'dream', sessionId: 'dream', roundId: confirmId }, clock })),
      initial_strength: initialStrength(),
      recorded_at: at,
    };
    const observationReceipt = commitControlled({
      control,
      clock,
      spec: {
        objectKey: `main:${observationId}`,
        targetDb: 'main',
        requestKey: `dream-confirm-observation:${confirmId}`,
        payloadHash: observationRow.payload_hash,
        immutablePayload: canonicalJson({ text: propositionText, source: 'dream', authorKind: 'model', origin }),
        targetIds: [observationId],
        hooks: options.hooks ?? {},
      },
      writeTxn: () => {
        if (!getObservation(main, observationId)) insertObservation(main, observationRow);
      },
      readExact: () => {
        const row = getObservation(main, observationId);
        return row ? { status: 'found', row } : { status: 'missing', reason: 'observation_absent' };
      },
    });
    if (observationReceipt.status !== 'found') {
      return { ok: false, code: observationReceipt.readback?.reason ?? 'proposition_observation_failed' };
    }
  }
  if (!getObservation(main, observationId)) return { ok: false, code: 'proposition_observation_failed' };

  const candidate = {
    id: candidateId,
    idempotency_key: `confirm:${confirmId}`,
    at,
    payload_hash: payloadHash({ snapshotHash, candidateId }),
    observation_id: observationId,
    source_unit: propositionId,
    source_path: 'confirm',
    text: draft.text,
    detail: draft.detail ?? null,
    why: draft.why,
    type: draft.type,
    scene: draft.scene,
    scope: draft.scope,
    tags: canonicalJson(draft.tags ?? []),
    topic_key: topic.topicKey,
    topic_components: canonicalJson(topic.components),
    registry_revision: topic.registryRevision,
    structured_value: draft.structuredValue !== undefined && draft.structuredValue !== null ? canonicalJson(draft.structuredValue) : null,
    semantic_status: 'accepted',
    record_kind: draft.recordKind ?? 'assertion',
    origin: canonicalJson([modelOrigin({ sessionId: 'dream', callId: confirmId, identity: 'owner' }), `${dreamId}#p${propositionOrdinal}`]),
    confidence: 0.9,
    lossy: 0,
    start_at: draft.startAt ?? null,
    end_at: draft.endAt ?? null,
    prec_start: draft.precStart ?? 'unknown',
    prec_end: draft.precEnd ?? 'unknown',
    time_state: draft.timeState ?? 'point',
    due_at: draft.dueAt ?? null,
    weight: draft.weight ?? 5,
    pointer_status: draft.pointerStatus ?? 'unknown',
    pointer_location: draft.pointerLocation ?? null,
    pointer_search_hint: draft.pointerSearchHint ?? null,
    judgment_id: draft.judgmentId ?? null,
    creator_session_id: 'dream',
    owner_touched: 1,
    reason: 'dream_confirmed',
    resolved_from: null,
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime: { phase: 'dream', sessionId: 'dream', roundId: confirmId }, clock })),
    initial_strength: initialStrength(),
    status: 'pending',
    promoted_at: null,
    rejected_reason: null,
    review_policy: 'candidate-v1',
    policy_revision: '1',
    deadline_at: null,
    created_input_seq: 0,
    recorded_at: at,
    key_status: topic.keyStatus,
    binding_status: 'accepted',
    binding_basis: canonicalJson({ receiptId, textHash, ruleRevision: 'topic-v1', components: topic.components }),
    origin_mode: 'inherited',
  };
  const evidence = [{
    id: objectId('ev', `candidate:${candidateId}:${observationId}:confirm`),
    memory_id: null,
    candidate_id: candidateId,
    observation_id: observationId,
    source_memory_id: null,
    role: 'basis',
    source_span: `bytes:0:${Buffer.byteLength(propositionText, 'utf8')}`,
    at,
  }];
  const mainSpec = {
    objectKey: `main:${candidateId}`,
    targetDb: 'main',
    requestKey: `dream-confirm-candidate:${confirmId}`,
    payloadHash: candidate.payload_hash,
    immutablePayload: canonicalJson({ confirmId, candidateId, snapshotHash }),
    targetIds: [candidateId],
    hooks: {},
  };
  let mainReceipt = { status: 'found' };
  if (!getCandidate(main, candidateId)) {
    mainReceipt = commitControlled({
      control,
      clock,
      spec: mainSpec,
      writeTxn: () =>
        withImmediate(main, () => {
          if (getCandidate(main, candidateId)) return;
          insertCandidate(main, candidate);
          for (const row of evidence) insertEvidence(main, row);
          promoteInTransaction(main, { candidate, runtime: { role: 'dream', sessionId: 'dream', identity: 'owner' }, clock });
        }),
      readExact: () => {
        const stored = getCandidate(main, candidateId);
        if (!stored) return { status: 'missing', reason: 'candidate_absent' };
        const memory = getMemory(main, objectId('mem', `promote:${candidateId}`));
        if (!memory) return { status: 'unknown', reason: 'memory_absent' };
        const ids = listEvidence(main, 'candidate', candidateId).map((row) => objectId('ev', `${memory.id}:${row.id}`));
        return readExactMemorySet(main, memory, ids);
      },
    });
  }
  if (mainReceipt.status !== 'found') {
    return { ok: false, code: mainReceipt.readback?.reason ?? 'main_promotion_failed', confirmId, candidateId };
  }
  const memory = getMemory(main, objectId('mem', `promote:${candidateId}`));
  appendRelation(main, {
    type: 'dream-confirm-link',
    payload: { confirmId, memoryId: memory?.id ?? null, dreamId, propositionId },
    businessKey: confirmId,
    at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  return { ok: true, confirmId, candidateId, memoryId: memory?.id ?? null, snapshotHash };
}

/** Owner unconfirm: dream event + main revoked marker; facts stay readable. */
export function unconfirmDream(deps, { receiptId, confirmId, memoryId, propositionId, dreamId }) {
  const { main, dream, clock } = deps;
  const verified = verifyReceiptBound(main, {
    receiptId,
    action: 'unconfirm-dream',
    targetIds: [confirmId],
    payload: unconfirmDreamPayload({ confirmId, memoryId, propositionId, dreamId }),
    baseVersions: [confirmId],
  });
  if (!verified.ok) return verified;
  const at = clock.at().at;
  withImmediate(dream, () => {
    appendDreamRelation(dream, clock, {
      type: 'unconfirm',
      payload: { confirmId, dreamId, propositionId, reason: 'owner_unconfirm' },
      businessKey: confirmId,
      at,
    });
  });
  appendRelation(main, {
    type: 'dream-revoke',
    payload: { confirmId, memoryId, propositionId, reason: 'owner_unconfirm' },
    businessKey: canonicalJson([confirmId, memoryId]),
    at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  consumeReceipt(main, clock, receiptId);
  return { ok: true, confirmId, revoked: true };
}

export function voidDream(deps, { receiptId, dreamId, memoryIds = [] }) {
  const { main, dream, clock } = deps;
  const verified = verifyReceiptBound(main, {
    receiptId,
    action: 'void-dream',
    targetIds: [dreamId],
    payload: voidDreamPayload({ dreamId }),
    baseVersions: [dreamId],
  });
  if (!verified.ok) return verified;
  const at = clock.at().at;
  withImmediate(dream, () => {
    appendDreamRelation(dream, clock, {
      type: 'dream-void',
      payload: { dreamId, reason: 'owner_void' },
      businessKey: dreamId,
      at,
    });
  });
  const links = main
    .prepare("SELECT payload FROM relations WHERE type = 'dream-confirm-link' AND json_extract(payload, '$.dreamId') = ?")
    .all(dreamId)
    .map((row) => JSON.parse(row.payload));
  for (const link of links) {
    const already = main
      .prepare("SELECT 1 AS ok FROM relations WHERE type = 'dream-revoke' AND json_extract(payload, '$.confirmId') = ?")
      .get(link.confirmId);
    if (already) continue;
    appendRelation(main, {
      type: 'dream-revoke',
      payload: { confirmId: link.confirmId, dreamId, memoryId: link.memoryId, reason: 'owner_void' },
      businessKey: canonicalJson([link.confirmId, link.memoryId ?? dreamId]),
      at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
  }
  consumeReceipt(main, clock, receiptId);
  return { ok: true, dreamId, revoked: links.length || memoryIds.length };
}

export { nextCommitSeq, readExactObservation, readExactCandidate, WriteError };
