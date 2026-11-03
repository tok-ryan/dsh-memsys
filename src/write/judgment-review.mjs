import { canonicalJson, objectId } from '../identity.mjs';
import { appendRelation, getRelationByDedupe } from '../storage/repositories.mjs';
import { effectiveVerdict, readJudgmentState, writeJudgmentState } from './judgment.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NEEDS_REVIEW_POLICY = 'needs-review-v1';

/**
 * Needs-review is a review-queue item plus an event; it never changes outcome
 * or an existing verdict. Same judgment + trigger + source version is idempotent.
 */
export function createNeedsReview(db, { judgmentId, trigger, sourceVersion, why, scene = 'work', scope = 'work-only', at, inputSeq = 0 }) {
  const reviewId = objectId('rq', `needs-review:${judgmentId}:${trigger}:${sourceVersion}`);
  const existing = db.prepare('SELECT * FROM review_queue WHERE id = ?').get(reviewId);
  if (existing) return { reviewId, replayed: true };
  const deadlineAt = new Date(Date.parse(at) + DAY_MS).toISOString();
  const businessKey = canonicalJson([judgmentId, trigger, sourceVersion]);
  const dedupe = canonicalJson(['needs-review', businessKey]);
  if (!getRelationByDedupe(db, dedupe)) {
    appendRelation(db, {
      type: 'needs-review',
      payload: {
        judgmentId,
        trigger,
        sourceVersion,
        why,
        scene,
        scope,
        review_policy: NEEDS_REVIEW_POLICY,
        policyRevision: '1',
        deadline_at: deadlineAt,
        created_input_seq: inputSeq,
      },
      businessKey,
      at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
  }
  db.prepare(
    `INSERT INTO review_queue
       (id, object_kind, object_id, review_policy, policy_revision, deadline_at,
        created_input_seq, status, close_reason, created_at, updated_at)
     VALUES (?, 'needs-review', ?, ?, '1', ?, ?, 'open', NULL, ?, ?)`,
  ).run(reviewId, judgmentId, NEEDS_REVIEW_POLICY, deadlineAt, inputSeq, at, at);
  const state = readJudgmentState(db, judgmentId);
  writeJudgmentState(db, judgmentId, { ...state, needsReview: true }, state.outcomeRevision);
  return { reviewId, replayed: false };
}

/**
 * 30-day aging: no verdict -> auto/unverified; only self -> needs-review;
 * any master or existing auto verdict is left untouched. Clock rollback pauses.
 */
export function ageJudgments(db, { clock, thresholdDays = 30, inputSeq = 0 }) {
  const reading = clock.at();
  if (reading.anomaly) return { autoAging: 0, needsReview: 0, skipped: 'clock_backwards' };
  const nowMs = clock.now().getTime();
  const threshold = thresholdDays * DAY_MS;
  const judgments = db.prepare('SELECT * FROM judgments').all();
  const relations = db.prepare('SELECT * FROM relations ORDER BY commit_seq, ordinal, id').all();
  let autoAging = 0;
  let needsReview = 0;
  for (const judgment of judgments) {
    const verdict = effectiveVerdict(relations, judgment.id);
    if (verdict && (verdict.by === 'master' || verdict.by === 'auto')) continue;
    const anchorAt = verdict?.at ?? judgment.at;
    if (nowMs - Date.parse(anchorAt) < threshold) continue;

    if (!verdict) {
      const businessKey = canonicalJson([judgment.id, 'aging', `initial:${judgment.payload_hash}`]);
      const dedupe = canonicalJson(['verdict', businessKey]);
      if (getRelationByDedupe(db, dedupe)) continue;
      const payload = {
        judgmentId: judgment.id,
        by: 'auto',
        result: 'unverified',
        basis: '30-day aging without verdict',
        falsifier: 'any later owner verdict or new evidence',
        evidence_refs: [],
        evidenceOrigin: judgment.evidence_origin,
        requestId: 'aging',
        itemSlot: 0,
      };
      const event = appendRelation(db, {
        type: 'verdict',
        payload,
        businessKey,
        at: reading.at,
        keyEncoding: 'canonical',
        eventVersion: '2',
        payloadVersion: '2',
      });
      const state = readJudgmentState(db, judgment.id);
      writeJudgmentState(
        db,
        judgment.id,
        { ...state, verdict: { id: event.id, by: 'auto', result: 'unverified', at: reading.at } },
        state.outcomeRevision,
      );
      autoAging += 1;
    } else if (verdict.by === 'self') {
      const sourceVersion = `${judgment.id}:${verdict.id}`;
      const created = createNeedsReview(db, {
        judgmentId: judgment.id,
        trigger: 'aging',
        sourceVersion,
        why: 'self verdict older than threshold',
        at: reading.at,
        inputSeq,
      });
      if (!created.replayed) needsReview += 1;
    }
  }
  return { autoAging, needsReview, at: reading.at };
}

/** Deadline exit: close the active review item, keep "unreviewed", change no verdict. */
export function deferExpiredNeedsReview(db, { clock, inputSeq = 0 }) {
  const reading = clock.at();
  const rows = db
    .prepare("SELECT * FROM review_queue WHERE object_kind = 'needs-review' AND status = 'open'")
    .all();
  let deferred = 0;
  for (const queue of rows) {
    const byTime = queue.deadline_at && Date.parse(reading.at) >= Date.parse(queue.deadline_at);
    const byInputs = Number(inputSeq) - Number(queue.created_input_seq) >= 3;
    if (!byTime && !byInputs) continue;
    const dedupe = canonicalJson(['review-defer', queue.id]);
    if (!getRelationByDedupe(db, dedupe)) {
      appendRelation(db, {
        type: 'review-defer',
        payload: {
          reviewId: queue.id,
          reason: 'review_window_expired',
          triggerId: queue.object_id,
          policyRevision: '1',
        },
        businessKey: queue.id,
        at: reading.at,
        keyEncoding: 'canonical',
        eventVersion: '2',
        payloadVersion: '2',
      });
    }
    db.prepare("UPDATE review_queue SET status = 'closed', close_reason = 'review-defer', updated_at = ? WHERE id = ?").run(reading.at, queue.id);
    const state = readJudgmentState(db, queue.object_id);
    writeJudgmentState(
      db,
      queue.object_id,
      { ...state, needsReview: false, unreviewed: true },
      state.outcomeRevision,
    );
    deferred += 1;
  }
  return { deferred, at: reading.at };
}

/** Topic collision: a new candidate or memory shares a resolved judgment topic. */
export function needsReviewOnTopicCollision(db, { judgmentId, sourceVersion, at, inputSeq }) {
  return createNeedsReview(db, {
    judgmentId,
    trigger: 'topic_collision',
    sourceVersion,
    why: 'resolved topic key collides with an existing judgment',
    at,
    inputSeq,
  });
}
