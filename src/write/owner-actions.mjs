import { canonicalJson, payloadHash } from '../identity.mjs';
import { appendRelation, getRelationByDedupe } from '../storage/repositories.mjs';
import { withImmediate } from '../storage/open.mjs';
import { effectiveVerdict, readJudgmentState, writeJudgmentState } from './judgment.mjs';

const RESULTS = ['right', 'wrong', 'pending', 'unverified'];

function receiptRow(db, receiptId) {
  const row = db.prepare('SELECT * FROM relations WHERE id = ?').get(receiptId);
  if (!row || row.type !== 'approval-receipt') return null;
  return { row, payload: JSON.parse(row.payload) };
}

export function isConsumed(db, receiptId) {
  return Boolean(getRelationByDedupe(db, canonicalJson(['receipt-consumed', receiptId])));
}

/**
 * Trusted operator fixture / controlled channel issues the binding receipt.
 * The payload hash and target versions are fixed here, never by the model.
 */
export function issueReceipt(db, clock, { ownerId, proposalId, action, payloadHash, targetIds = [], baseVersions = [], nonce, inputEventId }) {
  if (!ownerId || !proposalId || !action || !payloadHash || !nonce || !inputEventId) {
    throw new Error('invalid_receipt_fields');
  }
  const businessKey = canonicalJson([inputEventId, proposalId]);
  const dedupe = canonicalJson(['approval-receipt', businessKey]);
  const existing = getRelationByDedupe(db, dedupe);
  if (existing) return { receiptId: existing.id, replayed: true };
  const event = appendRelation(db, {
    type: 'approval-receipt',
    payload: {
      ownerId,
      proposalId,
      action,
      payloadHash,
      targetIds,
      baseVersions,
      nonce,
      inputEventId,
    },
    businessKey,
    at: clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  return { receiptId: event.id, replayed: false };
}


/**
 * Owner receipt binding: action + targets + the full payload hash + baseVersions
 * must all match. Any field changed after approval invalidates the receipt.
 */
export function verifyReceiptBound(db, {
  receiptId,
  action,
  targetIds = [],
  payload = null,
  payloadHash: expectedHash = null,
  baseVersions = null,
}) {
  const receipt = receiptRow(db, receiptId);
  if (!receipt) return { ok: false, code: 'receipt_missing' };
  if (receipt.payload.action !== action) return { ok: false, code: 'receipt_action_mismatch' };
  const approvedTargets = receipt.payload.targetIds ?? [];
  for (const target of targetIds) {
    if (!approvedTargets.includes(target)) return { ok: false, code: 'receipt_target_mismatch', target };
  }
  const requiredHash = expectedHash ?? (payload === null ? null : payloadHash(payload));
  if (requiredHash === null) return { ok: false, code: 'receipt_payload_unbound' };
  if (receipt.payload.payloadHash !== requiredHash) return { ok: false, code: 'receipt_hash_mismatch' };
  if (baseVersions !== null) {
    if (canonicalJson(receipt.payload.baseVersions ?? []) !== canonicalJson(baseVersions)) {
      return { ok: false, code: 'receipt_base_version_mismatch' };
    }
  }
  if (isConsumed(db, receiptId)) return { ok: false, code: 'receipt_already_consumed' };
  return { ok: true, payload: receipt.payload };
}

export function masterVerdictPayload({ judgmentId, result, basis, falsifier = '', evidenceRefs = [] }) {
  return { judgmentId, result, basis: basis ?? null, falsifier, evidenceRefs };
}

export function verdictVoidPayload({ judgmentId, verdictId, reason }) {
  return { judgmentId, verdictId, reason: reason ?? null };
}

export function masterVerdictPayloadHash(fields) {
  return payloadHash(masterVerdictPayload(fields));
}

export function verdictVoidPayloadHash(fields) {
  return payloadHash(verdictVoidPayload(fields));
}

export function verifyReceipt(db, { receiptId, action = null, payloadHash = null }) {
  const receipt = receiptRow(db, receiptId);
  if (!receipt) return { ok: false, code: 'receipt_missing' };
  if (action && receipt.payload.action !== action) return { ok: false, code: 'receipt_action_mismatch' };
  if (payloadHash && receipt.payload.payloadHash !== payloadHash) {
    return { ok: false, code: 'receipt_hash_mismatch' };
  }
  if (isConsumed(db, receiptId)) return { ok: false, code: 'receipt_already_consumed' };
  return { ok: true, payload: receipt.payload };
}

export function consumeReceipt(db, clock, receiptId) {
  const existing = getRelationByDedupe(db, canonicalJson(['receipt-consumed', receiptId]));
  if (existing) return { ok: false, code: 'receipt_already_consumed' };
  appendRelation(db, {
    type: 'receipt-consumed',
    payload: { receiptId },
    businessKey: receiptId,
    at: clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  return { ok: true };
}

/** Lock-internal receipt revalidation: re-read approval, then consume in the same transaction. */
export function revalidateReceipt(db, clock, { receiptId, action, targetIds = [], payload = null, payloadHash: expectedHash = null, baseVersions = null }) {
  if (isConsumed(db, receiptId)) return { ok: false, code: 'receipt_already_consumed' };
  const verified = verifyReceiptBound(db, {
    receiptId,
    action,
    targetIds,
    payload,
    payloadHash: expectedHash,
    baseVersions,
  });
  if (!verified.ok) return verified;
  return consumeReceipt(db, clock, receiptId);
}

/** Master verdict is reachable only through a verified binding receipt. */
export function applyMasterVerdict(db, clock, { receiptId, judgmentId, result, basis, falsifier = '', evidenceRefs = [] }) {
  if (!RESULTS.includes(result)) return { ok: false, code: 'validation_error', field: 'result' };
  const judgment = db.prepare('SELECT * FROM judgments WHERE id = ?').get(judgmentId);
  if (!judgment) return { ok: false, code: 'validation_error', field: 'judgmentId' };
  const verified = verifyReceiptBound(db, {
    receiptId,
    action: 'master-verdict',
    targetIds: [judgmentId],
    payload: masterVerdictPayload({ judgmentId, result, basis, falsifier, evidenceRefs }),
    baseVersions: [judgment.payload_hash],
  });
  if (!verified.ok) return verified;
  return withImmediate(db, () => {
    const businessKey = canonicalJson([judgmentId, receiptId, 'master']);
    const existing = getRelationByDedupe(db, canonicalJson(['verdict', businessKey]));
    if (existing) return { ok: true, replayed: true, verdictId: existing.id };
    const consumed = revalidateReceipt(db, clock, {
      receiptId,
      action: 'master-verdict',
      targetIds: [judgmentId],
      payload: masterVerdictPayload({ judgmentId, result, basis, falsifier, evidenceRefs }),
      baseVersions: [judgment.payload_hash],
    });
    if (!consumed.ok) return consumed;
    const event = appendRelation(db, {
      type: 'verdict',
      payload: {
        judgmentId,
        by: 'master',
        result,
        basis: basis ?? 'owner verdict',
        falsifier,
        evidence_refs: evidenceRefs,
        evidenceOrigin: judgment.evidence_origin,
        receiptId,
        requestId: receiptId,
        itemSlot: 0,
      },
      businessKey,
      at: clock.at().at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
    const state = readJudgmentState(db, judgmentId);
    writeJudgmentState(
      db,
      judgmentId,
      { ...state, verdict: { id: event.id, by: 'master', result, at: clock.at().at } },
      state.outcomeRevision,
    );
    return { ok: true, replayed: false, verdictId: event.id };
  });
}

/** Owner-bound verdict void; the old verdict row stays in the ledger. */
export function voidMasterVerdict(db, clock, { receiptId, judgmentId, verdictId, reason }) {
  const judgment = db.prepare('SELECT * FROM judgments WHERE id = ?').get(judgmentId);
  if (!judgment) return { ok: false, code: 'validation_error', field: 'judgmentId' };
  const verified = verifyReceiptBound(db, {
    receiptId,
    action: 'verdict-void',
    targetIds: [judgmentId, verdictId],
    payload: verdictVoidPayload({ judgmentId, verdictId, reason }),
    baseVersions: [judgment.payload_hash, verdictId],
  });
  if (!verified.ok) return verified;
  return withImmediate(db, () => {
    const businessKey = canonicalJson([verdictId, receiptId]);
    const existing = getRelationByDedupe(db, canonicalJson(['verdict-void', businessKey]));
    if (existing) return { ok: true, replayed: true };
    const consumed = revalidateReceipt(db, clock, {
      receiptId,
      action: 'verdict-void',
      targetIds: [judgmentId, verdictId],
      payload: verdictVoidPayload({ judgmentId, verdictId, reason }),
      baseVersions: [judgment.payload_hash, verdictId],
    });
    if (!consumed.ok) return consumed;
    appendRelation(db, {
      type: 'verdict-void',
      payload: { verdictId, judgmentId, receiptId, reason: reason ?? 'owner void' },
      businessKey,
      at: clock.at().at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
    const relations = db
      .prepare('SELECT * FROM relations ORDER BY commit_seq, ordinal, id')
      .all();
    const state = readJudgmentState(db, judgmentId);
    writeJudgmentState(
      db,
      judgmentId,
      { ...state, verdict: effectiveVerdict(relations, judgmentId) },
      state.outcomeRevision,
    );
    return { ok: true, replayed: false };
  });
}

export function sceneExpansionPayload({ candidateId, payloadHash: candidateHash }) {
  return { action: 'scene-expansion-approval', candidateId, payloadHash: candidateHash };
}

export function sceneExpansionPayloadHash(fields) {
  return payloadHash(sceneExpansionPayload(fields));
}
