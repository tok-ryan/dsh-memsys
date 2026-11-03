import {
  appendRelation,
  getDueQueue,
  insertDueQueue,
  listDueQueue,
  updateDueQueueState,
} from '../storage/repositories.mjs';

const PENDING_LIMIT = 100;
const PENDING_MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Model extraction only ever reaches pending-due; never open. */
export function dueStateForCandidate(candidate) {
  const hasDue = candidate.due_at !== null && candidate.due_at !== undefined;
  return hasDue || candidate.type === 'promise' ? 'pending-due' : 'none';
}

export function registerDueOnPromote(db, { memoryId, memory, candidate, at, commitSeq }) {
  const dueState = dueStateForCandidate(candidate);
  insertDueQueue(db, {
    memory_id: memoryId,
    due_state: dueState,
    enqueued_seq: commitSeq,
    enqueued_at: at,
    opened_at: null,
    deadline_at: candidate.due_at ?? null,
    revision: 0,
    reason: 'promote',
  });
  if (dueState !== 'none') {
    db.prepare('UPDATE memories SET due_state = ? WHERE id = ?').run(dueState, memoryId);
  }
  return dueState;
}

function shelveDue(db, memoryId, at, reason, revision) {
  db.prepare('UPDATE memories SET due_state = ? WHERE id = ?').run('shelved-due', memoryId);
  updateDueQueueState(db, memoryId, 'shelved-due', revision, reason);
  appendRelation(db, {
    type: 'due-state',
    payload: { memoryId, from: 'pending-due', to: 'shelved-due', reason },
    businessKey: `${memoryId}:${reason}:${revision}`,
    at,
  });
}

/**
 * Cross-window pending-due cap: 100 per owner identity. The oldest entries by
 * enqueue sequence are shelved inside the same write transaction. Shelving does
 * not retire the fact and never edits the original text.
 */
export function enforcePendingDueCap(db, { identity, at }) {
  let rows = listDueQueue(db, 'pending-due');
  if (rows.length <= PENDING_LIMIT) return 0;
  const overflow = rows.length - PENDING_LIMIT;
  const oldest = rows.slice(0, overflow);
  let shelved = 0;
  for (const row of oldest) {
    shelveDue(db, row.memory_id, at, 'cap-100', Number(row.revision) + 1);
    shelved += 1;
  }
  return shelved;
}

/** pending-due older than 14 days becomes shelved-due; a backwards clock pauses aging. */
export function agePendingDue(db, { clock, now = null }) {
  const reading = clock.at();
  if (reading.anomaly) return { aged: 0, skipped: 'clock_backwards', at: reading.at };
  const nowMs = now === null ? Date.parse(reading.at) : Date.parse(now);
  const rows = listDueQueue(db, 'pending-due');
  let aged = 0;
  for (const row of rows) {
    const enqueued = Date.parse(row.enqueued_at);
    if (!Number.isFinite(enqueued)) continue;
    if (nowMs - enqueued >= PENDING_MAX_AGE_DAYS * DAY_MS) {
      shelveDue(db, row.memory_id, reading.at, 'pending-due-14d', Number(row.revision) + 1);
      aged += 1;
    }
  }
  return { aged, at: reading.at };
}

export function getDueState(db, memoryId) {
  return getDueQueue(db, memoryId)?.due_state ?? null;
}

export const PENDING_DUE_LIMIT = PENDING_LIMIT;
export const PENDING_DUE_MAX_AGE_DAYS = PENDING_MAX_AGE_DAYS;
