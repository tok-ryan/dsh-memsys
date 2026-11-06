import { replayMain } from '../storage/replay.mjs';
import { pageText } from './pager.mjs';

const DEFAULT_MAX_CHARS = 8000;

function clampChars(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(16000, Math.max(1000, Math.round(value)));
}

function decodeCursor(cursor) {
  if (cursor === null) return { index: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.tool !== 'memsys_review_get') return null;
    return { index: Number(parsed.index ?? 0) };
  } catch {
    return null;
  }
}

function candidateEntries(main, queue) {
  const candidate = main.prepare('SELECT * FROM candidates WHERE id = ?').get(queue.object_id);
  if (!candidate) return null;
  const evidence = main
    .prepare('SELECT * FROM evidence WHERE candidate_id = ? ORDER BY id')
    .all(candidate.id);
  return {
    id: queue.id,
    kind: queue.object_kind,
    object_id: candidate.id,
    text: candidate.text,
    why: candidate.why,
    status: candidate.status,
    semantic_status: candidate.semantic_status,
    scene: candidate.scene,
    scope: candidate.scope,
    deadline: queue.deadline_at,
    default_outcome:
      queue.review_policy === 'capture-v1'
        ? { action: 'shelve', reason: 'raw_capture_unreviewed' }
        : { action: 'review-defer', reason: 'needs-review' },
    actions: ['reject_candidate', 'promote_candidate'],
    evidence: evidence.map((row) => ({
      id: row.id,
      observation_id: row.observation_id,
      role: row.role,
      source_span: row.source_span,
    })),
    history: [],
  };
}

function pendingEntries(main, queue) {
  return {
    id: queue.id,
    kind: 'pending',
    object_id: queue.object_id,
    text: null,
    why: null,
    status: queue.status,
    deadline: queue.deadline_at,
    default_outcome: { action: 'pending-resolve', result: 'deferred', reason: 'owner_action_closed_in_batch' },
    actions: [],
    evidence: [],
    history: [],
  };
}

function needsReviewEntries(main) {
  return main
    .prepare(
      `SELECT rq.*, j.verdict_text AS judgment_text, j.basis AS judgment_basis,
              j.outcome AS judgment_outcome
       FROM review_queue AS rq
       LEFT JOIN judgments AS j ON j.id = rq.object_id
       WHERE rq.object_kind = 'needs-review' AND rq.status = 'open'
       ORDER BY rq.created_input_seq ASC, rq.id ASC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      kind: 'needs-review',
      object_id: row.object_id,
      text: row.judgment_text ?? null,
      why: row.judgment_basis ?? null,
      status: row.judgment_outcome ?? null,
      deadline: row.deadline_at,
      default_outcome: { action: 'review-defer', reason: 'review_window_expired' },
      actions: [],
      evidence: [],
      history: [],
    }));
}

/**
 * Closed review rows whose candidate was promoted without a review are audit
 * evidence, not a lost submission: this view surfaces them so the owner can see
 * what was auto-passed and revoke an auto-promoted memory if it was wrong.
 */
function autoPromotedEntry(main, queue) {
  const candidate = main.prepare('SELECT * FROM candidates WHERE id = ?').get(queue.object_id);
  if (!candidate) return null;
  const memory = main.prepare('SELECT id FROM memories WHERE promoted_from = ?').get(candidate.id) ?? null;
  const state = memory ? replayMain(main).memories.get(memory.id) ?? 'active' : null;
  return {
    id: queue.id,
    kind: 'auto-promoted',
    object_id: candidate.id,
    memory_id: memory?.id ?? null,
    text: candidate.text,
    why: candidate.why,
    type: candidate.type,
    status: state === 'retired' ? 'revoked' : state === null ? 'memory_missing' : 'auto-promoted',
    memory_state: state,
    promoted_at: candidate.promoted_at,
    closed_at: queue.updated_at,
    close_reason: queue.close_reason,
    actions: state === 'active' ? ['revoke'] : [],
  };
}

function autoPromotedEntries(main) {
  return main
    .prepare(
      `SELECT * FROM review_queue
       WHERE object_kind = 'candidate' AND status = 'closed' AND close_reason = 'auto-promoted'
       ORDER BY created_input_seq ASC, id ASC`,
    )
    .all()
    .map((queue) => autoPromotedEntry(main, queue))
    .filter(Boolean);
}

function entryForQueue(main, queue) {
  if (queue.object_kind === 'pending') return pendingEntries(main, queue);
  if (queue.close_reason === 'auto-promoted') return autoPromotedEntry(main, queue);
  return candidateEntries(main, queue);
}

function dueHistoryEntries(main) {
  return main
    .prepare(
      `SELECT dq.*, m.text AS memory_text, m.due_state AS memory_due_state
       FROM due_queue AS dq
       JOIN memories AS m ON m.id = dq.memory_id
       ORDER BY dq.enqueued_seq ASC, dq.memory_id ASC`,
    )
    .all()
    .map((row) => ({
      id: `due:${row.memory_id}`,
      kind: 'due-history',
      object_id: row.memory_id,
      text: row.memory_text,
      status: row.due_state,
      deadline: row.deadline_at,
      default_outcome: { action: 'keep', reason: 'no_auto_done' },
      actions: [],
      evidence: [],
      history: [{ from: 'pending-due', to: row.due_state, at: row.enqueued_at, reason: row.reason }],
    }));
}

/**
 * memsys_review_get: candidate / permission-pending / due-history pages. These
 * are review items, never fact text.
 */
export function reviewGet({ main, clock, ids = null, kind = null, cursor = null, maxChars = DEFAULT_MAX_CHARS }) {
  const reading = clock.at().at;
  if (ids !== null && kind !== null) {
    return { status: 'error', code: 'validation_error', message: 'ids_or_kind_exclusive', clock: reading };
  }
  if (ids !== null) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) {
      return { status: 'error', code: 'validation_error', message: 'ids_must_be_1_to_10', clock: reading };
    }
  } else if (!['candidate', 'pending', 'due-history', 'needs-review', 'auto-promoted'].includes(kind)) {
    return { status: 'error', code: 'validation_error', message: 'invalid_kind', clock: reading };
  }

  let entries = [];
  try {
    if (kind === 'due-history') {
      entries = dueHistoryEntries(main);
    } else if (kind === 'needs-review') {
      entries = needsReviewEntries(main);
    } else if (kind === 'auto-promoted') {
      entries = autoPromotedEntries(main);
    } else if (ids !== null) {
      const queues = ids.map((id) => main.prepare('SELECT * FROM review_queue WHERE id = ?').get(id)).filter(Boolean);
      entries = queues.map((queue) => entryForQueue(main, queue)).filter(Boolean);
    } else {
      const queues = main
        .prepare("SELECT * FROM review_queue WHERE status = 'open' AND object_kind = ? ORDER BY created_input_seq, id")
        .all(kind);
      entries = queues
        .map((queue) => (kind === 'pending' ? pendingEntries(main, queue) : candidateEntries(main, queue)))
        .filter(Boolean);
    }
  } catch (err) {
    return { status: 'error', code: 'read_error', message: err.message, clock: reading };
  }

  const decoded = decodeCursor(cursor);
  if (!decoded) return { status: 'error', code: 'invalid_cursor', clock: reading };
  const budget = clampChars(maxChars);
  const page = [];
  let used = 0;
  let index = decoded.index;
  while (index < entries.length) {
    const entry = entries[index];
    const size = Array.from(`${entry.id}${entry.text ?? ''}`).length;
    if (page.length > 0 && used + size > budget) break;
    page.push(entry);
    used += size;
    index += 1;
  }
  const nextCursor =
    index < entries.length
      ? Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_review_get', index }), 'utf8').toString('base64url')
      : null;

  return {
    status: 'ok',
    entries: page,
    total_count: entries.length,
    next_cursor: nextCursor,
    truncated: nextCursor !== null,
    clock: reading,
  };
}

export { pageText };
