import { keys, objectId, payloadHash, canonicalJson } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  closeReviewQueue,
  getCandidate,
  getCandidateByKey,
  getReviewQueueByObject,
  insertCandidate,
  insertEvidence,
  listCandidatesByStatus,
  listEvidence,
  openReviewQueue,
} from '../storage/repositories.mjs';
import { agePendingDue } from './due.mjs';
import { promoteInTransaction } from './promote.mjs';
import { deferExpiredNeedsReview } from './judgment-review.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable default operation id: candidate + policy + deadline (not "this startup"). */
function deriveShelveOperationId(candidate) {
  return payloadHash({
    candidateId: candidate.id,
    reviewPolicy: candidate.review_policy,
    deadlineAt: candidate.deadline_at ?? null,
    reason: 'raw_capture_unreviewed',
  });
}

function deadlinePassed(at, deadlineAt) {
  if (!deadlineAt) return false;
  return Date.parse(at) >= Date.parse(deadlineAt);
}

function shelveCapture(main, candidate, queue, at) {
  // Only status is mutable on candidates; the reason lives in the event.
  main.prepare('UPDATE candidates SET status = ? WHERE id = ?').run('shelved', candidate.id);
  const operationId = deriveShelveOperationId(candidate);
  appendRelation(main, {
    type: 'shelve',
    payload: {
      targetType: 'candidate',
      targetId: candidate.id,
      reason: 'raw_capture_unreviewed',
      receiptId: null,
      reviewId: queue?.id ?? null,
    },
    businessKey: canonicalJson([candidate.id, operationId]),
    at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  if (queue) closeReviewQueue(main, queue.id, 'raw_capture_unreviewed', at);
}

/**
 * Default exit for a resolved-topic divergence: create the coexist candidate,
 * promote it, shelve the old candidate and close the pending row in ONE
 * transaction. A later failure leaves the old pending untouched.
 */
function coexistInTransaction(main, { candidate, queue, runtime, clock, at }) {
  const businessKey = keys.coexist(queue.id);
  const existing = getCandidateByKey(main, businessKey);
  if (existing) {
    closeReviewQueue(main, queue.id, 'coexist', at);
    return existing;
  }
  const newCandidate = {
    ...candidate,
    id: objectId('cand', businessKey),
    idempotency_key: businessKey,
    at,
    recorded_at: at,
    payload_hash: payloadHash({
      text: candidate.text,
      why: candidate.why,
      coexistOf: queue.id,
    }),
    semantic_status: 'proposed',
    record_kind: 'assertion',
    status: 'pending',
    promoted_at: null,
    rejected_reason: null,
    reason: 'coexist',
    deadline_at: null,
    review_policy: 'candidate-v1',
    resolved_from: candidate.id,
  };
  insertCandidate(main, newCandidate);
  for (const evidence of listEvidence(main, 'candidate', candidate.id)) {
    insertEvidence(main, {
      id: objectId('ev', `candidate:${newCandidate.id}:${evidence.observation_id}:${evidence.source_span}`),
      memory_id: null,
      candidate_id: newCandidate.id,
      observation_id: evidence.observation_id,
      source_memory_id: evidence.source_memory_id,
      role: evidence.role,
      source_span: evidence.source_span,
      at,
    });
  }
  promoteInTransaction(main, { candidate: newCandidate, runtime, clock });
  main.prepare('UPDATE candidates SET status = ? WHERE id = ?').run('shelved', candidate.id);
  appendRelation(main, {
    type: 'shelve',
    payload: { targetId: candidate.id, reason: 'coexist', receiptId: null },
    businessKey: `${candidate.id}:coexist`,
    at,
  });
  appendRelation(main, {
    type: 'pending-resolve',
    payload: {
      pendingId: queue.id,
      result: 'coexist',
      actor: 'system',
      newCandidateId: newCandidate.id,
      reason: 'default_coexist',
    },
    businessKey: queue.id,
    at,
  });
  closeReviewQueue(main, queue.id, 'coexist', at);
  return newCandidate;
}

/**
 * Deadline scan for capture shelving, conflict coexist, permission deferral and
 * pending-due aging. Runs on start, real input and maintenance; never invents
 * owner decisions.
 */
export function scanReviews(runtime, inputSeq, deps) {
  const { main, clock } = deps;
  const reading = clock.at();
  const at = reading.at;
  const summary = { shelvedCaptures: 0, coexisted: 0, deferred: 0, aged: 0 };

  withImmediate(main, () => {
    for (const candidate of listCandidatesByStatus(main, 'pending')) {
      if (candidate.source_path !== 'capture') continue;
      const queue = getReviewQueueByObject(main, 'capture', candidate.id);
      const byTime = deadlinePassed(at, queue?.deadline_at ?? candidate.deadline_at);
      const byInputs = queue ? Number(inputSeq) - Number(queue.created_input_seq) >= 3 : false;
      if (!byTime && !byInputs) continue;
      shelveCapture(main, candidate, queue, at);
      summary.shelvedCaptures += 1;
    }

    for (const candidate of listCandidatesByStatus(main, 'conflicted')) {
      const queue = getReviewQueueByObject(main, 'pending', candidate.id);
      if (!queue || queue.status !== 'open') continue;
      if (!deadlinePassed(at, queue.deadline_at)) continue;
      coexistInTransaction(main, { candidate, queue, runtime, clock, at });
      summary.coexisted += 1;
    }

    for (const queue of openReviewQueue(main, 'open')) {
      if (queue.object_kind !== 'pending') continue;
      const candidate = getCandidate(main, queue.object_id);
      if (candidate && candidate.status === 'conflicted') continue;
      if (!deadlinePassed(at, queue.deadline_at)) continue;
      appendRelation(main, {
        type: 'pending-resolve',
        payload: {
          pendingId: queue.id,
          result: 'deferred',
          actor: 'system',
          reason: 'owner_action_closed_in_batch',
        },
        businessKey: queue.id,
        at,
      });
      closeReviewQueue(main, queue.id, 'deferred', at);
      summary.deferred += 1;
    }

    const deferredNeeds = deferExpiredNeedsReview(main, { clock, inputSeq });
    summary.deferred += deferredNeeds.deferred;
    if (!reading.anomaly) summary.aged = agePendingDue(main, { clock }).aged;
  });

  return summary;
}

/** Record a permission proposal; it stays pending and never executes in batch 1. */
export function proposeOwnerAction(runtime, request, deps) {
  const { main, clock } = deps;
  const at = clock.at().at;
  const action = request.action;
  const targetIds = request.targetIds ?? [];
  const proposalId = objectId('rq', `pending:${action}:${canonicalJson(request)}`);
  return withImmediate(main, () => {
    const existing = main.prepare('SELECT * FROM review_queue WHERE id = ?').get(proposalId);
    if (!existing) {
      main
        .prepare(
          `INSERT INTO review_queue
             (id, object_kind, object_id, review_policy, policy_revision, deadline_at,
              created_input_seq, status, close_reason, created_at, updated_at)
           VALUES (?, 'pending', ?, 'candidate-v1', '1', ?, 0, 'open', NULL, ?, ?)`,
        )
        .run(proposalId, action, new Date(Date.parse(at) + DAY_MS).toISOString(), at, at);
    }
    appendRelation(main, {
      type: 'pending',
      payload: {
        requestId: proposalId,
        kind: action,
        refs: targetIds,
        request_payload: request.payload ?? null,
        baseVersions: request.baseVersions ?? [],
      },
      businessKey: proposalId,
      at,
    });
    return { status: 'pending', pendingId: proposalId, executed: false };
  });
}

export const CAPTURE_DEADLINE_MS = DAY_MS;
