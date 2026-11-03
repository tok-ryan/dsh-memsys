import { getState } from '../storage/repositories.mjs';
import { parseOriginTokens, foldOrigin } from '../write/origin.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function dueTypedId(memoryId) {
  return `review:due:${memoryId}`;
}

function tensionClass(item, nowMs) {
  const due = item.due_at ? Date.parse(item.due_at) : null;
  if (due !== null && Number.isFinite(due) && due <= nowMs) return 2;
  if (due !== null && Number.isFinite(due)) return 1;
  return 0;
}

function mentionClass(db, memoryId) {
  const trusted = db
    .prepare("SELECT 1 AS ok FROM relations WHERE type = 'due-mention' AND json_extract(payload, '$.memoryId') = ?")
    .get(memoryId);
  return trusted ? 2 : 0;
}

/**
 * The pending-due recall set D. It is deliberately separate from the fact set S:
 * never injected as fixed columns, never counted into P.
 */
export function selectPendingDue({ main, mode, now = new Date() }) {
  const nowMs = now.getTime();
  const rows = main
    .prepare(
      `SELECT m.*, t.start_at AS business_start, t.time_state AS time_state,
              dq.enqueued_seq AS enqueued_seq, dq.enqueued_at AS enqueued_at,
              dq.opened_at AS opened_at, dq.deadline_at AS queue_deadline_at, dq.deadline_at AS due_at
       FROM memories AS m
       LEFT JOIN timeline AS t ON t.memory_id = m.id
       LEFT JOIN due_queue AS dq ON dq.memory_id = m.id
       WHERE m.due_state = 'pending-due'
       ORDER BY m.id`,
    )
    .all();
  const items = [];
  for (const row of rows) {
    if (row.credibility === 'from-dream') continue;
    const sceneOk = row.scene === mode || row.scene === 'both';
    const scopeOk =
      row.scope === 'global' ||
      (mode === 'life' ? row.scope === 'life-only' : row.scope === 'work-only');
    if (!sceneOk || !scopeOk) continue;
    const folded = foldOrigin(row.origin, { db: main });
    if (folded.unsafe || folded.credibility === 'from-dream') continue;
    items.push({
      ...row,
      typed_id: dueTypedId(row.id),
      tension: tensionClass(row, nowMs),
      mention: mentionClass(main, row.id),
      enqueued_seq: Number(row.enqueued_seq ?? 0),
    });
  }
  return items;
}

/** Stable dictionary order: tension, mention, enqueue order, due upper bound, id. */
export function orderPendingDue(items) {
  return items.slice().sort((a, b) => {
    if (b.tension !== a.tension) return b.tension - a.tension;
    if (b.mention !== a.mention) return b.mention - a.mention;
    if (b.enqueued_seq !== a.enqueued_seq) return b.enqueued_seq - a.enqueued_seq;
    const aDue = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
    const bDue = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function dueDirectoryLine(item, maxCodePoints = 80) {
  const points = Array.from(item.text ?? '');
  const summary = points.length > maxCodePoints ? `${points.slice(0, maxCodePoints - 1).join('')}…` : points.join('');
  const due = item.due_at ? item.due_at.slice(0, 16).replace('T', ' ') : 'unknown';
  return `${item.typed_id} · ${summary} · 期限：${due} · 未确认`;
}

export function duePolicyState(db) {
  return getState(db, 'due-policy:due-policy-v1')?.value ?? null;
}

export function pendingDueCounts(db, mode) {
  return { pending: selectPendingDue({ main: db, mode }).length };
}

export { DAY_MS, tensionClass, mentionClass };
