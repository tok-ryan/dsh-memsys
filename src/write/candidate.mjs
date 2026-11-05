import { canonicalJson, formatSourceSpan, keys, objectId, parseSourceSpan, payloadHash } from '../identity.mjs';
import { initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactCandidate, readExactMemorySet } from '../control/readback.mjs';
import { withImmediate, withSavepoint } from '../storage/open.mjs';
import {
  appendRelation,
  findCandidateEntity,
  getCandidate,
  getCandidateByKey,
  getMemoryByBusinessKey,
  getObservation,
  getReviewQueueByObject,
  getState,
  insertCandidate,
  insertCandidateEntity,
  insertEvidence,
  insertReviewQueue,
  listEvidence,
  listMemoriesByTopic,
} from '../storage/repositories.mjs';
import {
  WriteError,
  assertDailyRuntime,
  assertNoForbiddenFields,
  assertOwnPendingCandidate,
  modelOrigin,
  stripAuditTimes,
} from './authority.mjs';
import { composeCandidateOrigin, credibilityOf } from './origin.mjs';
import { candidateEntityId, resolveTopic, unresolvedTopicKey } from './topic.mjs';
import { promoteInTransaction } from './promote.mjs';
import { revalidateReceipt, verifyReceiptBound } from './owner-actions.mjs';
import { createNeedsReview } from './judgment-review.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function scopeToId(runtime, scope) {
  if (scope === 'global') return 'global';
  if (scope === 'work-only') return 'work';
  if (scope === 'life-only') return 'life';
  // Default: the scope of the current window only.
  return runtime.mode ?? runtime.phase ?? 'work';
}

export function expectedWindowScope(runtime) {
  return runtime.mode === 'life' ? 'life-only' : 'work-only';
}

/** Shared candidate-row builder (capture and tool paths use the same mapping). */
export function makeCandidateRow(options) {
  const {
    runtime,
    clock,
    observation,
    businessKey,
    sourcePath,
    sourceUnit,
    text,
    detail = null,
    why,
    type,
    scene,
    scope,
    semanticStatus = 'proposed',
    recordKind = 'assertion',
    tags = [],
    topic = null,
    structuredValue = null,
    timeState = 'point',
    startAt = null,
    endAt = null,
    precStart = 'unknown',
    precEnd = 'unknown',
    dueAt = null,
    weight = 5,
    pointerStatus = 'unknown',
    pointerLocation = null,
    pointerSearchHint = null,
    judgmentId = null,
    status = 'pending',
    reason = null,
    reviewPolicy = 'candidate-v1',
    deadlineAt = null,
    createdInputSeq = 0,
    origin,
    confidence = 0.5,
  } = options;
  const at = clock.at().at;
  return {
    id: objectId('cand', businessKey),
    idempotency_key: businessKey,
    at,
    payload_hash: payloadHash({
      text,
      detail,
      why,
      type,
      scene,
      scope,
      sourceUnit,
      structuredValue,
      semanticStatus,
      recordKind,
    }),
    observation_id: observation.id,
    source_unit: sourceUnit,
    source_path: sourcePath,
    text,
    detail,
    why,
    type,
    scene,
    scope,
    tags: canonicalJson(tags),
    topic_key: topic?.topicKey ?? null,
    topic_components: topic?.components ? canonicalJson(topic.components) : null,
    registry_revision: topic?.registryRevision ?? null,
    structured_value: structuredValue === null ? null : canonicalJson(structuredValue),
    semantic_status: semanticStatus,
    record_kind: recordKind,
    origin,
    confidence,
    lossy: 0,
    start_at: startAt,
    end_at: endAt,
    prec_start: precStart,
    prec_end: precEnd,
    time_state: timeState,
    due_at: dueAt,
    weight,
    pointer_status: pointerStatus,
    pointer_location: pointerLocation,
    pointer_search_hint: pointerSearchHint,
    judgment_id: judgmentId,
    key_status: topic?.keyStatus ?? 'unresolved',
    binding_status: 'proposed',
    binding_basis: canonicalJson({
      ruleRevision: 'topic-v1',
      components: topic?.components ?? null,
      source: sourcePath,
    }),
    origin_mode: 'self',
    creator_session_id: runtime.sessionId,
    owner_touched: 0,
    reason,
    resolved_from: null,
    state_snapshot: JSON.stringify({
      captured_at: at,
      phase: runtime.phase ?? 'unknown',
      session_id: runtime.sessionId,
      round_id: runtime.roundId ?? null,
      active_project_id: null,
      energy: 'unknown',
      emotion: 'unknown',
      state_source_refs: [],
      strength_policy: 'initial-v1',
    }),
    initial_strength: initialStrength(),
    status,
    promoted_at: null,
    rejected_reason: null,
    review_policy: reviewPolicy,
    policy_revision: '1',
    deadline_at: deadlineAt,
    created_input_seq: createdInputSeq,
    recorded_at: at,
  };
}

export function inputSeqOfMain(main, identity) {
  const state = getState(main, `input-seq:${identity}`);
  return state ? Number(state.value.value ?? 0) : 0;
}

export function validateEvidenceRef(main, ref) {
  if (typeof ref === 'string') {
    const observation = getObservation(main, ref);
    if (!observation) throw new WriteError('evidence_observation_missing', { observationId: ref });
    return {
      observationId: ref,
      span: formatSourceSpan(0, Buffer.byteLength(observation.text, 'utf8')),
    };
  }
  if (!ref || typeof ref !== 'object') {
    throw new WriteError('validation_error', { field: 'evidence_refs' });
  }
  const observationId = ref.observationId ?? ref.evidenceRef;
  const spanText = ref.sourceSpan ?? ref.span;
  const observation = getObservation(main, observationId);
  if (!observation) {
    throw new WriteError('evidence_observation_missing', { observationId: observationId ?? null });
  }
  const span = parseSourceSpan(spanText);
  const bytes = Buffer.byteLength(observation.text, 'utf8');
  if (span.end > bytes) {
    throw new WriteError('evidence_span_out_of_range', { span: spanText, bytes });
  }
  if (ref.quote !== undefined) {
    const slice = Buffer.from(observation.text, 'utf8')
      .subarray(span.start, span.end)
      .toString('utf8');
    if (slice !== ref.quote) {
      throw new WriteError('evidence_span_mismatch', { expected: ref.quote, actual: slice });
    }
  }
  return { observationId, span: spanText };
}

function getJudgmentRef(db, id) {
  return db.prepare('SELECT 1 AS ok FROM judgments WHERE id = ?').get(id) ?? null;
}

function evidenceRowsForCandidate(candidateId, evidenceRefs, at) {
  return evidenceRefs.map((ref) => ({
    id: objectId('ev', `candidate:${candidateId}:${ref.observationId}:${ref.span}`),
    memory_id: null,
    candidate_id: candidateId,
    observation_id: ref.observationId,
    source_memory_id: null,
    role: 'basis',
    source_span: ref.span,
    at,
  }));
}

function reviewQueueRow({ kind, objectId: target, policy, deadlineAt, inputSeq, at, status = 'open' }) {
  return {
    id: objectId('rq', `${kind}:${target}:${inputSeq}`),
    object_kind: kind,
    object_id: target,
    review_policy: policy,
    policy_revision: '1',
    deadline_at: deadlineAt,
    created_input_seq: inputSeq,
    status,
    close_reason: null,
    created_at: at,
    updated_at: at,
  };
}

function sceneExpansion(item, runtime) {
  const proposedScope = item.scope;
  const proposedScene = item.scene;
  if (proposedScene === 'both') return 'both';
  if (proposedScope === 'global') return 'global';
  if (proposedScope === 'work-only' && runtime.mode === 'life') return 'work-only';
  if (proposedScope === 'life-only' && runtime.mode === 'work') return 'life-only';
  return null;
}

/**
 * Path B: record first-tier candidates. Each item is its own controlled commit
 * with candidate + evidence + optional mention + optional direct promotion.
 */
export function recordCandidates(runtime, request, deps) {
  assertDailyRuntime(runtime);
  const { main, control, clock } = deps;
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  const results = items.map((item, index) => recordOne(runtime, item, request, deps, index));
  void main;
  void control;
  void clock;
  return { items: results };
}

function recordOne(runtime, item, request, deps, index) {
  const { main, control, clock } = deps;
  try {
    assertNoForbiddenFields(item);
    const { item: clean, violations } = stripAuditTimes(item);
    if (clean.dueState === 'open' || clean.due_state === 'open') {
      throw new WriteError('validation_error', { field: 'due_state', rule: 'model_cannot_open_due' });
    }
    if (!clean.text || typeof clean.text !== 'string') {
      throw new WriteError('validation_error', { field: 'text' });
    }
    if (!clean.why || typeof clean.why !== 'string') {
      throw new WriteError('validation_error', { field: 'why' });
    }
    const observationId = clean.observationId ?? request?.observationId;
    const observation = getObservation(main, observationId);
    if (!observation) {
      throw new WriteError('evidence_observation_missing', { observationId: observationId ?? null });
    }
    const evidenceRefs = (clean.evidenceRefs ?? [observationId]).map((ref) =>
      validateEvidenceRef(main, ref),
    );
    if (evidenceRefs.length === 0) {
      throw new WriteError('validation_error', { field: 'evidence_refs' });
    }
    const sourceUnit = clean.sourceUnit ?? evidenceRefs[0].span;
    const scene = clean.scene ?? runtime.mode ?? 'work';
    const scope = clean.scope ?? expectedWindowScope(runtime);
    const type = clean.type ?? 'fact';
    if (!['identity', 'preference', 'promise', 'episode', 'fact', 'emotion', 'procedure'].includes(type)) {
      throw new WriteError('validation_error', { field: 'type' });
    }
    const weight = clean.weight ?? 5;
    if (typeof weight !== 'number' || weight < 0 || weight > 10) {
      throw new WriteError('validation_error', { field: 'weight' });
    }
    const timeState = clean.time?.timeState ?? 'point';
    if (timeState === 'exact' && (!clean.time?.start || !clean.time?.end)) {
      throw new WriteError('validation_error', { field: 'time', rule: 'exact_requires_both_ends' });
    }
    if (clean.dueAt && !clean.dueEvidenceRef) {
      throw new WriteError('validation_error', { field: 'due_at', rule: 'requires_evidence' });
    }

    const scopeId = scopeToId(runtime, scope);
    const topic = resolveTopic(main, clean.topicComponents ?? null, {
      scopeId,
      observationId,
      sourceUnit,
    });
    const judgmentId = clean.judgmentId ?? clean.judgment_id ?? null;
    if (judgmentId !== null) {
      if (typeof judgmentId !== 'string' || !judgmentId.startsWith('jdg_')) {
        throw new WriteError('validation_error', { field: 'judgmentId' });
      }
      if (!getJudgmentRef(main, judgmentId)) {
        throw new WriteError('validation_error', { field: 'judgmentId' });
      }
    }
    const structuredValue = clean.structuredValue ?? null;
    const semanticPayload = {
      text: clean.text,
      detail: clean.detail ?? null,
      why: clean.why,
      type,
      scene,
      scope,
      tags: clean.tags ?? [],
      structuredValue,
      judgmentId,
      sourceUnit,
      topicComponents: clean.topicComponents ?? null,
    };
    const businessKey = keys.proposal(observationId, sourceUnit, semanticPayload);
    const existingCandidate = getCandidateByKey(main, businessKey);
    if (existingCandidate) {
      const memory = getMemoryByBusinessKey(main, keys.promote(existingCandidate.id));
      return {
        operation_id: request?.requestId ?? null,
        id: existingCandidate.id,
        status: 'found',
        replayed: true,
        readback: memory ? 'memory' : 'candidate',
      };
    }

    const expansion = sceneExpansion(clean, runtime);
    const existingMemories = topic.keyStatus === 'resolved' ? listMemoriesByTopic(main, topic.topicKey) : [];
    let status = 'pending';
    let conflictWith = [];
    if (existingMemories.length > 0) {
      const sameValue = existingMemories.some(
        (memory) => (memory.structured_value ?? null) === (structuredValue === null ? null : canonicalJson(structuredValue)),
      );
      if (!sameValue) {
        status = 'conflicted';
        conflictWith = existingMemories.map((memory) => memory.id);
      }
    }
    if (expansion) status = 'pending';

    const at = clock.at().at;
    const inputSeq = inputSeqOfMain(main, runtime.identity);
    const candidate = makeCandidateRow({
      runtime,
      clock,
      observation,
      businessKey,
      sourcePath: 'tool',
      sourceUnit,
      text: clean.text,
      detail: clean.detail ?? null,
      why: clean.why,
      type,
      scene,
      scope,
      semanticStatus: 'proposed',
      recordKind: 'assertion',
      tags: clean.tags ?? [],
      topic,
      structuredValue,
      judgmentId,
      timeState,
      startAt: clean.time?.start ?? null,
      endAt: clean.time?.end ?? null,
      precStart: clean.time?.precStart ?? 'unknown',
      precEnd: clean.time?.precEnd ?? 'unknown',
      dueAt: clean.dueAt ?? null,
      weight,
      status,
      reason: expansion ? `scene_expansion_proposed:${expansion}` : status === 'conflicted' ? 'topic_collision' : null,
      reviewPolicy: 'candidate-v1',
      deadlineAt: new Date(Date.parse(at) + DAY_MS).toISOString(),
      createdInputSeq: inputSeq,
      origin: composeCandidateOrigin(
        main,
        evidenceRefs.map((ref) => ({ observation_id: ref.observationId })),
        modelOrigin(runtime),
      ),
    });

    const evidenceRows = evidenceRowsForCandidate(candidate.id, evidenceRefs, at);
    const mention = clean.entityMention
      ? {
          ref: validateEvidenceRef(main, {
            observationId,
            span: clean.entityMention.sourceSpan ?? clean.entityMention.span,
            quote: clean.entityMention.quote,
          }),
          raw: clean.entityMention,
        }
      : null;

    const spec = {
      objectKey: `main:${candidate.id}`,
      targetDb: 'main',
      requestKey: `candidate:${businessKey}`,
      payloadHash: candidate.payload_hash,
      immutablePayload: canonicalJson(semanticPayload),
      targetIds: [candidate.id, observationId],
      hooks: deps.commitHooks ?? {},
    };

    const writeTxn = () =>
      withImmediate(main, () => {
        insertCandidate(main, candidate);
        if (topic.keyStatus === 'resolved') {
          const collisions = main
            .prepare("SELECT id FROM judgments WHERE topic_key = ? AND key_status = 'resolved'")
            .all(topic.topicKey);
          for (const collision of collisions) {
            createNeedsReview(main, {
              judgmentId: collision.id,
              trigger: 'topic_collision',
              sourceVersion: `${candidate.id}:${candidate.payload_hash}`,
              why: 'resolved topic key collides with an existing judgment',
              at,
              inputSeq,
            });
          }
        }
        for (const row of evidenceRows) insertEvidence(main, row);
        if (mention) {
          const id = candidateEntityId(observationId, mention.ref.span, scopeId);
          if (!findCandidateEntity(main, id)) {
            insertCandidateEntity(main, {
              id,
              observation_id: observationId,
              source_span: mention.ref.span,
              original_bytes: Buffer.from(observation.text, 'utf8'),
              evidence_refs: canonicalJson([...new Set(evidenceRefs.map((ref) => ref.span))]),
              scope_id: scopeId,
              rule_revision: 'ce-v1',
              status: 'candidate',
              at,
              payload_hash: payloadHash({ observationId, span: mention.ref.span, scopeId }),
            });
            const evidenceRefsSorted = [...new Set(evidenceRefs.map((ref) => ref.span))];
            appendRelation(main, {
              type: 'candidate-entity',
              payload: {
                candidateEntityId: id,
                observationId,
                sourceSpan: mention.ref.span,
                originalBytesBase64: Buffer.from(observation.text, 'utf8').toString('base64'),
                evidenceRefs: evidenceRefsSorted,
                evidenceHash: payloadHash({ observationId, span: mention.ref.span, evidenceRefs: evidenceRefsSorted }),
                scopeId,
                ruleRevision: 'ce-v1',
                status: 'candidate',
              },
              businessKey: canonicalJson([observationId, mention.ref.span, scopeId]),
              at,
              keyEncoding: 'canonical',
              eventVersion: '2',
              payloadVersion: '2',
            });
          }
        }
        if (violations.length > 0) {
          appendRelation(main, {
            type: 'violation',
            payload: { kind: 'audit_time_rejected', fields: violations, sessionId: runtime.sessionId },
            businessKey: `${observationId}:${violations.join(',')}:${index}`,
            at,
          });
        }
        if (expansion) {
          insertReviewQueue(
            main,
            reviewQueueRow({
              kind: 'pending',
              objectId: candidate.id,
              policy: 'candidate-v1',
              deadlineAt: candidate.deadline_at,
              inputSeq,
              at,
            }),
          );
          appendRelation(main, {
            type: 'pending',
            payload: {
              requestId: `scene:${candidate.id}`,
              kind: 'scene-expansion',
              refs: [candidate.id],
              candidateId: candidate.id,
              reason: `scene_expansion:${expansion}`,
            },
            businessKey: `scene:${candidate.id}`,
            at,
          });
        } else if (status === 'conflicted') {
          appendRelation(main, {
            type: 'conflict',
            payload: {
              refs: [candidate.id, ...conflictWith],
              reason: 'topic_collision_value_differs',
              requestId: `conflict:${candidate.id}`,
            },
            businessKey: `conflict:${candidate.id}`,
            at,
          });
          insertReviewQueue(
            main,
            reviewQueueRow({
              kind: 'pending',
              objectId: candidate.id,
              policy: 'candidate-v1',
              deadlineAt: candidate.deadline_at,
              inputSeq,
              at,
            }),
          );
        } else if (status === 'pending' && existingMemories.length === 0) {
          // Complete candidate without a permission action: promote directly
          // (unresolved keys stay ungrouped; resolved first statements promote).
          insertReviewQueue(
            main,
            reviewQueueRow({
              kind: 'candidate',
              objectId: candidate.id,
              policy: 'candidate-v1',
              deadlineAt: candidate.deadline_at,
              inputSeq,
              at,
              status: 'closed',
            }),
          );
          withSavepoint(main, `promote_${candidate.id.slice(0, 12)}`, () =>
            promoteInTransaction(main, {
              candidate,
              runtime,
              clock,
              hooks: deps.faultInjector?.promoteHooks ?? {},
            }),
          );
        } else {
          insertReviewQueue(
            main,
            reviewQueueRow({
              kind: 'candidate',
              objectId: candidate.id,
              policy: 'candidate-v1',
              deadlineAt: candidate.deadline_at,
              inputSeq,
              at,
            }),
          );
        }
      });

    const readExact = () => {
      const memory = getMemoryByBusinessKey(main, keys.promote(candidate.id));
      if (memory) {
        return readExactMemorySet(
          main,
          memory,
          evidenceRows.map((row) => objectId('ev', `${memory.id}:${row.id}`)),
        );
      }
      return readExactCandidate(main, candidate);
    };

    const receipt = commitControlled({ control, clock, spec, writeTxn, readExact });
    return {
      operation_id: request?.requestId ?? null,
      id: candidate.id,
      status: receipt.status,
      readback: receipt.readback?.status ?? receipt.status,
      pendingId:
        status === 'conflicted' || expansion
          ? getReviewQueueByObject(main, 'pending', candidate.id)?.id ?? null
          : null,
      error: receipt.status === 'found' ? null : receipt.readback?.reason ?? 'readback_not_found',
      detail: receipt.status === 'found' ? null : receipt.readback?.error ?? null,
      failures: receipt.consecutiveFailures,
      frozen: receipt.frozen,
    };
  } catch (err) {
    if (err instanceof WriteError) {
      return { operation_id: request?.requestId ?? null, error: err.code, detail: err.detail ?? null };
    }
    return { operation_id: request?.requestId ?? null, error: err.message ?? 'write_failed' };
  }
}

/** Promote one pending candidate through the six-step transaction. */
function sceneExpansionOf(candidate, runtime) {
  const windowScene = runtime.mode === 'life' ? 'life' : 'work';
  if (candidate.scene === 'both') return 'scene_both';
  if (candidate.scene !== windowScene) return 'scene_cross_window';
  if (candidate.scope === 'global') return 'scope_global';
  if (candidate.scope === 'work-only' && runtime.mode === 'life') return 'scope_cross_window';
  if (candidate.scope === 'life-only' && runtime.mode === 'work') return 'scope_cross_window';
  return null;
}

/**
 * Scene/scope expansion is an owner permission. Promotion must re-check it even
 * when the candidate was created in an earlier turn; a pending candidate alone is
 * not an approval.
 */
function assertPromotionExpansionApproved(main, candidate, runtime) {
  const expansion = sceneExpansionOf(candidate, runtime);
  if (!expansion) return;
  const approval = main
    .prepare(
      `SELECT 1 AS ok FROM relations
       WHERE type = 'scene-expansion-approval'
         AND json_extract(payload, '$.candidateId') = ?
         AND json_extract(payload, '$.payloadHash') = ?`,
    )
    .get(candidate.id, candidate.payload_hash);
  if (!approval) {
    throw new WriteError('invalid_transition', {
      reason: 'scene_expansion_unapproved',
      candidateId: candidate.id,
      expansion,
    });
  }
}

function promoteCandidateCore(runtime, candidateId, baseRevision, deps, { asOwner = false } = {}) {
  if (asOwner) {
    if (!baseRevision) throw new WriteError('validation_error', { field: 'baseRevision' });
    runtime = { role: 'owner', identity: 'owner', sessionId: 'owner', callId: 'owner' };
  } else {
    assertDailyRuntime(runtime);
  }
  const { main, control, clock } = deps;
  const candidate = getCandidate(main, candidateId);
  if (!candidate) throw new WriteError('candidate_missing', { candidateId });
  if (candidate.status === 'promoted') {
    const memory = getMemoryByBusinessKey(main, keys.promote(candidateId));
    return { status: 'found', replayed: true, id: memory?.id ?? null };
  }
  if (candidate.status !== 'pending') {
    throw new WriteError('candidate_not_pending', { status: candidate.status });
  }
  if (asOwner && baseRevision !== candidate.payload_hash) {
    throw new WriteError('stale_candidate', { baseRevision, current: candidate.payload_hash });
  }
  if (!asOwner && baseRevision && baseRevision !== candidate.payload_hash) {
    throw new WriteError('stale_candidate', { baseRevision, current: candidate.payload_hash });
  }
  if (!asOwner) assertPromotionExpansionApproved(main, candidate, runtime);
  const ownerOrigin = asOwner ? JSON.stringify([`owner@${clock.at().at}`]) : null;
  const expectedOrigin = ownerOrigin ?? candidate.origin;
  const spec = {
    objectKey: `main:${keys.promote(candidateId)}`,
    targetDb: 'main',
    requestKey: `promote:${candidateId}`,
    payloadHash: candidate.payload_hash,
    immutablePayload: canonicalJson({ candidateId, baseRevision: candidate.payload_hash }),
    targetIds: [candidateId],
    expected: {
      kind: 'promote',
      payloadHash: candidate.payload_hash,
      projectionHash: payloadHash({
        id: objectId('mem', keys.promote(candidateId)),
        text: candidate.text,
        scene: candidate.scene,
        scope: candidate.scope,
        semantic_status: candidate.semantic_status,
        credibility: credibilityOf(main, expectedOrigin),
        due_state: candidate.due_at ? 'pending-due' : 'none',
        topic_key: candidate.topic_key ?? null,
      }),
      events: [{ type: 'promote', key: candidateId }],
    },
    actual: () => ({
      row: getMemoryByBusinessKey(main, keys.promote(candidateId)),
      events: main
        .prepare("SELECT payload FROM relations WHERE type = 'promote' AND json_extract(payload, '$.candidateId') = ?")
        .all(candidateId)
        .map((row) => ({ type: 'promote', key: candidateId })),
    }),
    hooks: deps.commitHooks ?? {},
  };
  const receipt = commitControlled({
    control,
    clock,
    spec,
    writeTxn: () =>
      withImmediate(main, () =>
        withSavepoint(main, `promote_${candidateId.slice(0, 12)}`, () =>
          promoteInTransaction(main, {
            candidate,
            runtime,
            clock,
            origin: ownerOrigin,
            hooks: deps.faultInjector?.promoteHooks ?? {},
          }),
        ),
      ),
    readExact: () => {
      const memory = getMemoryByBusinessKey(main, keys.promote(candidateId));
      if (!memory) return { status: 'missing', reason: 'memory_absent' };
      const evidenceIds = listEvidence(main, 'candidate', candidateId).map((row) =>
        objectId('ev', `${memory.id}:${row.id}`),
      );
      return readExactMemorySet(main, memory, evidenceIds);
    },
  });
  const memory = getMemoryByBusinessKey(main, keys.promote(candidateId));
  return {
    status: receipt.status,
    id: memory?.id ?? null,
    operationId: receipt.operationId,
    failures: receipt.consecutiveFailures,
    frozen: receipt.frozen,
  };
}

export function promoteCandidate(runtime, candidateId, baseRevision, deps) {
  return promoteCandidateCore(runtime, candidateId, baseRevision, deps);
}

/** Owner-side promotion: skips model role/expansion gates, records owner origin. */
export function promoteCandidateAsOwner(runtime, candidateId, baseRevision, deps) {
  return promoteCandidateCore(runtime, candidateId, baseRevision, deps, { asOwner: true });
}

/** Owner-side rejection: no creator_session_id or daily-role restriction. */
export function rejectCandidateAsOwner(runtime, candidateId, reason, deps) {
  const { main, clock } = deps;
  return withImmediate(main, () => {
    const candidate = getCandidate(main, candidateId);
    if (!candidate) throw new WriteError('candidate_missing', { candidateId });
    if (candidate.status !== 'pending') throw new WriteError('candidate_not_pending', { status: candidate.status });
    const at = clock.at().at;
    main.prepare('UPDATE candidates SET status = ?, rejected_reason = ? WHERE id = ?').run(
      'rejected',
      reason ?? 'rejected_by_owner',
      candidateId,
    );
    appendRelation(main, {
      type: 'reject',
      payload: { targetId: candidateId, reason: reason ?? 'rejected_by_owner', by: 'owner', origin: `owner@${at}`, receiptId: null },
      businessKey: `${candidateId}:${reason ?? 'rejected_by_owner'}`,
      at,
    });
    return { status: 'found', id: candidateId };
  });
}

/** A model may only reject its own untouched pending candidate. */
export function rejectCandidate(runtime, candidateId, reason, deps) {
  assertDailyRuntime(runtime);
  const { main, clock } = deps;
  return withImmediate(main, () => {
    const candidate = getCandidate(main, candidateId);
    assertOwnPendingCandidate(runtime, candidate);
    const at = clock.at().at;
    main.prepare('UPDATE candidates SET status = ?, rejected_reason = ? WHERE id = ?').run(
      'rejected',
      reason ?? 'rejected_by_model',
      candidateId,
    );
    appendRelation(main, {
      type: 'reject',
      payload: { targetId: candidateId, reason: reason ?? 'rejected_by_model', receiptId: null },
      businessKey: `${candidateId}:${reason ?? 'rejected_by_model'}`,
      at,
    });
    return { status: 'found', id: candidateId };
  });
}

/** Owner-bound approval for a scene/scope expansion of one exact candidate payload. */
export function approveSceneExpansion(deps, { receiptId, candidateId }) {
  const { main, clock } = deps;
  const row = getCandidate(main, candidateId);
  if (!row) return { ok: false, code: 'candidate_missing' };
  const verified = verifyReceiptBound(main, {
    receiptId,
    action: 'scene-expansion-approval',
    targetIds: [candidateId],
    payload: { action: 'scene-expansion-approval', candidateId, payloadHash: row.payload_hash },
    baseVersions: [row.payload_hash],
  });
  if (!verified.ok) return verified;
  return withImmediate(main, () => {
    deps.beforeReceiptGate?.();
    const gate = revalidateReceipt(main, clock, {
      receiptId,
      action: 'scene-expansion-approval',
      targetIds: [candidateId],
      payload: { action: 'scene-expansion-approval', candidateId, payloadHash: row.payload_hash },
      baseVersions: [row.payload_hash],
    });
    if (!gate.ok) return gate;
    appendRelation(main, {
      type: 'scene-expansion-approval',
    payload: {
      candidateId,
      payloadHash: row.payload_hash,
      receiptId,
      approvedAt: clock.at().at,
    },
    businessKey: candidateId + ':' + row.payload_hash,
    at: clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
    });
    return { ok: true, candidateId };
  });
}
