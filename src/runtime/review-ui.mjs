/**
 * Read + limited write adapter for the review tabs (candidates / pending / dreams).
 *
 * Reads reuse the existing review layer (`reviewGet`, `dreamReviewList`).
 * Writes reuse the owner-channel command handler for due items. Candidate
 * promote/reject has NO owner path in core today: `promoteCandidate` asserts a
 * `daily` model runtime and `rejectCandidate` additionally requires the caller to
 * own the candidate's session, so a settings-page caller cannot honestly use
 * them. This module reports that instead of spoofing a model runtime.
 */
import * as candidateWrites from '../write/candidate.mjs';
import { reviewGet } from '../read/review.mjs';
import { dreamReviewList } from '../read/dream.mjs';
import { duePayloadHash, handleOwnerDueCommand } from '../write/due-actions.mjs';
import { isLoopback, sameOrigin } from './summary.mjs';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

const slicePage = (items, offset, limit) => items.slice(offset, offset + limit);

export function listCandidates(main, clock, { limit = LIMIT_DEFAULT, offset = 0 } = {}) {
  const result = reviewGet({ main, clock, kind: 'candidate' });
  if (result.status !== 'ok') return { status: 'error', code: result.code ?? 'review_unavailable' };
  const entries = (result.entries ?? result.items ?? []).map((entry) => {
    const row = main.prepare('SELECT payload_hash, recorded_at, type FROM candidates WHERE id = ?').get(entry.object_id) ?? {};
    return {
      id: entry.object_id,
      queue_id: entry.id,
      text: entry.text ?? '',
      why: entry.why ?? null,
      type: row.type ?? null,
      status: entry.status ?? null,
      recorded_at: row.recorded_at ?? null,
      // promoteCandidate compares this with candidate.payload_hash.
      base_revision: row.payload_hash ?? null,
      actions: ['promote', 'reject'],
    };
  });
  return { status: 'ok', total: entries.length, items: slicePage(entries, offset, limit) };
}

export function listPending(main, clock, { limit = LIMIT_DEFAULT, offset = 0 } = {}) {
  const result = reviewGet({ main, clock, kind: 'due-history' });
  if (result.status !== 'ok') return { status: 'error', code: result.code ?? 'review_unavailable' };
  const entries = (result.entries ?? result.items ?? [])
    .filter((entry) => entry.status === 'pending-due' || entry.status === 'shelved-due')
    .map((entry) => {
      const queue = main.prepare('SELECT revision, due_at, enqueued_at FROM due_queue WHERE memory_id = ?').get(entry.object_id) ?? {};
      return {
        id: entry.object_id,
        text: entry.text ?? '',
        due_state: entry.status,
        due_at: queue.due_at ?? entry.deadline ?? null,
        enqueued_at: queue.enqueued_at ?? null,
        revision: Number(queue.revision ?? 0),
        // done/dropped exist; 延后 does not (the command set has no postpone).
        actions: ['confirm', 'shelve'],
      };
    });
  return { status: 'ok', total: entries.length, items: slicePage(entries, offset, limit) };
}

export function listDreams(dream, clock, { limit = LIMIT_DEFAULT, offset = 0 } = {}) {
  const result = dreamReviewList({ dream, clock });
  if (result.status !== 'ok') return { status: 'error', code: result.code ?? 'dreams_unavailable' };
  const entries = (result.items ?? []).map((entry) => {
    const row = dream.prepare('SELECT at FROM dreams WHERE id = ?').get(entry.dreamId) ?? {};
    return {
      id: entry.dreamId,
      text: entry.idea ?? '',
      recorded_at: row.at ?? null,
      status: entry.voided ? 'voided' : 'active',
      propositions: Array.isArray(entry.propositions) ? entry.propositions.length : 0,
    };
  });
  return { status: 'ok', total: entries.length, items: slicePage(entries, offset, limit) };
}

/**
 * Owner actions for a due item, routed through the existing command handler.
 * `confirm` = due-confirm (pending-due -> open) then due-done done;
 * `shelve`  = the same confirm, then due-done dropped;
 * anything else is refused with the real reason instead of a silent success.
 */
export function applyPendingAction({ main, control, clock }, { id, action, revision }) {
  const base = { main, control, clock };
  const stamp = Date.now();
  const confirm = () => handleOwnerDueCommand(base, {
    text: `/mem due-confirm ${id} ${revision} ${duePayloadHash(id, revision)}`,
    inputEventId: `ui-confirm-${id}-${revision}-${stamp}`,
    ownerId: 'owner-ui',
  });
  const done = (how) => handleOwnerDueCommand(base, {
    text: `/mem due-done ${id} ${revision} ${how}`,
    inputEventId: `ui-${how}-${id}-${revision}-${stamp}`,
    ownerId: 'owner-ui',
  });

  if (action === 'confirm') {
    const opened = confirm();
    if (!opened.ok) return opened;
    return done('done');
  }
  if (action === 'shelve') {
    const opened = confirm();
    if (!opened.ok) return opened;
    return done('dropped');
  }
  if (action === 'postpone') {
    return {
      ok: false,
      code: 'action_unavailable',
      reason: 'no_postpone_command',
      message: '现有命令只有 due-confirm / due-restore / due-done(done|dropped) / due-mention，没有"延后"；需要核心先加这个动作。',
    };
  }
  return { ok: false, code: 'unknown_action', action };
}

export function applyCandidateAction({ main, control, clock }, { id, action, reason, baseRevision }) {
  const ownerRuntime = {
    role: 'owner',
    identity: 'owner-ui',
    sessionId: 'owner-ui',
    callId: `ui-${Date.now()}`,
  };
  const deps = { main, control, clock };
  const ownerPromote = candidateWrites.promoteCandidateAsOwner;
  const ownerReject = candidateWrites.rejectCandidateAsOwner;

  if (action === 'promote' && typeof ownerPromote === 'function') {
    return ownerPromote(ownerRuntime, id, baseRevision ?? null, deps);
  }
  if (action === 'reject' && typeof ownerReject === 'function') {
    return ownerReject(ownerRuntime, id, reason ?? null, deps);
  }
  return {
    ok: false,
    code: 'owner_candidate_action_unavailable',
    reason: 'no_owner_runtime',
    message: action === 'promote'
      ? '核心还没有 owner 的批准通道（promoteCandidateAsOwner）；promoteCandidate 只接受 role=daily 的模型运行时，设置页不能冒充。'
      : '核心还没有 owner 的驳回通道（rejectCandidateAsOwner）；rejectCandidate 还要求调用方拥有该候选的会话。',
    id,
    action,
  };
}

/** GET/POST /dsh-memsys/api/review — same loopback + same-origin gate as summary. */
export function createReviewHandler({ main, control = null, dream, clock, logger = console } = {}) {
  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };
  const parse = (url) => {
    const raw = String(url ?? '');
    const index = raw.indexOf('?');
    return new URLSearchParams(index < 0 ? '' : raw.slice(index + 1));
  };
  const guard = (req, res) => {
    if (!isLoopback(req) || !sameOrigin(req)) { send(res, 403, { error: 'forbidden' }); return false; }
    return true;
  };

  return (req, res) => {
    if (!guard(req, res)) return;
    if (req.method === 'POST') {
      const type = String(req.headers?.['content-type'] ?? '').toLowerCase();
      if (!type.includes('application/json')) { send(res, 415, { error: 'json_required' }); return; }
      let body = '';
      req.on?.('data', (chunk) => { body += chunk; });
      req.on?.('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body || '{}'); } catch { send(res, 400, { error: 'invalid_json' }); return; }
        const kind = String(parsed?.kind ?? '');
        const id = String(parsed?.id ?? '');
        const action = String(parsed?.action ?? '');
        if (!['candidate', 'pending'].includes(kind)) { send(res, 400, { error: 'invalid_kind' }); return; }
        if (!id) { send(res, 400, { error: 'empty_id' }); return; }
        if (!action) { send(res, 400, { error: 'empty_action' }); return; }
        try {
          const result = kind === 'pending'
            ? applyPendingAction({ main, control, clock }, { id, action, revision: Number(parsed.revision) })
            : applyCandidateAction({ main, control, clock }, { id, action, reason: parsed.reason ?? null, baseRevision: parsed.baseRevision ?? null });
          const ok = result?.ok !== false && result?.status !== 'error';
          send(res, ok ? 200 : 409, { ok, kind, id, action, result });
        } catch (err) {
          const code = err?.code ?? 'write_failed';
          const status = code === 'stale_candidate'
            ? 409
            : code === 'candidate_missing'
              ? 404
              : code === 'validation_error'
                ? 400
                : code === 'candidate_not_pending'
                  ? 409
                  : 500;
          send(res, status, {
            ok: false,
            error: code,
            code,
            message: String(err?.message ?? err),
            ...(code === 'stale_candidate' ? { current: err?.detail?.current ?? err?.current ?? null } : {}),
          });
        }
      });
      return;
    }
    if (req.method && req.method !== 'GET') { send(res, 405, { error: 'method_not_allowed' }); return; }
    const params = parse(req.url);
    const kind = String(params.get('kind') ?? 'candidate');
    const limit = Math.min(LIMIT_MAX, Math.max(1, Number(params.get('limit')) || LIMIT_DEFAULT));
    const offset = Math.max(0, Number(params.get('offset')) || 0);
    try {
      const result = kind === 'candidate'
        ? listCandidates(main, clock, { limit, offset })
        : kind === 'pending'
          ? listPending(main, clock, { limit, offset })
          : kind === 'dream'
            ? listDreams(dream, clock, { limit, offset })
            : { status: 'error', code: 'invalid_kind' };
      if (result.status !== 'ok') { send(res, 400, { error: result.code ?? 'review_unavailable' }); return; }
      send(res, 200, { kind, total: result.total, items: result.items });
    } catch (err) {
      logger?.warn?.(`[dsh-memsys] review list failed: ${err?.message ?? err}`);
      send(res, 503, { error: 'review_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}
