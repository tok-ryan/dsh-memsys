import { canonicalJson } from '../identity.mjs';

export function listDreamRelations(dream) {
  return dream
    .prepare('SELECT * FROM relations ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all();
}

function payloadOf(relation) {
  try {
    return JSON.parse(relation.payload);
  } catch {
    return null;
  }
}

/**
 * Fold dream confirmations. Latest confirm per proposition is effective unless an
 * unconfirm (by confirmId) or dream-void (by dreamId) follows it.
 */
export function confirmationState(dream) {
  const relations = listDreamRelations(dream);
  const confirms = new Map();
  const unconfirmed = new Set();
  const voidedDreams = new Set();
  for (const relation of relations) {
    const payload = payloadOf(relation);
    if (!payload) continue;
    if (relation.type === 'confirm') {
      const list = confirms.get(payload.propositionId) ?? [];
      list.push({
        confirmId: payload.confirmId,
        dreamId: payload.dreamId,
        propositionId: payload.propositionId,
        textHash: payload.textHash,
        path: payload.path,
        receiptId: payload.receiptId,
        memoryId: payload.memoryId ?? null,
        commitSeq: Number(relation.commit_seq),
      });
      confirms.set(payload.propositionId, list);
    } else if (relation.type === 'unconfirm') {
      unconfirmed.add(payload.confirmId);
    } else if (relation.type === 'dream-void') {
      voidedDreams.add(payload.dreamId);
    }
  }
  const state = new Map();
  for (const [propositionId, list] of confirms) {
    const valid = list
      .filter((confirm) => !unconfirmed.has(confirm.confirmId) && !voidedDreams.has(confirm.dreamId))
      .sort((a, b) => b.commitSeq - a.commitSeq)[0];
    if (valid) state.set(propositionId, { ...valid, valid: true });
    else {
      const latest = list.slice().sort((a, b) => b.commitSeq - a.commitSeq)[0];
      state.set(propositionId, { ...latest, valid: false });
    }
  }
  return state;
}

export function dreamStatus(dream, dreamId) {
  const row = dream.prepare('SELECT * FROM dreams WHERE id = ?').get(dreamId);
  if (!row) return null;
  const propositions = dream
    .prepare('SELECT * FROM propositions WHERE dream_id = ? ORDER BY ordinal')
    .all(dreamId);
  const candidates = dream
    .prepare('SELECT * FROM candidates WHERE dream_id = ? ORDER BY proposition_id, id')
    .all(dreamId);
  const confirmations = confirmationState(dream);
  const voided = listDreamRelations(dream)
    .filter((relation) => relation.type === 'dream-void')
    .map((relation) => payloadOf(relation))
    .some((payload) => payload?.dreamId === dreamId);
  return {
    dream: row,
    voided,
    propositions: propositions.map((proposition) => ({
      ...proposition,
      confirmation: confirmations.get(proposition.id) ?? null,
    })),
    candidates,
  };
}

export function dreamSnapshotPayloadHash(payload) {
  return canonicalJson(payload);
}
