import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { commitControlled } from '../control/commit.mjs';
import { withImmediate } from '../storage/open.mjs';
import { appendRelation, getMemory, getState, putState } from '../storage/repositories.mjs';
import { consumeReceipt, issueReceipt, verifyReceipt } from './owner-actions.mjs';
import { duePolicyState } from '../context/pending-due.mjs';

export const P_LIMITS = Object.freeze({ members: 64, bytes: 12288, hRatio: 0.6 });
export const POLICY_REVISION = 'due-policy-v1';

const COMMANDS = [
  ['due-policy-approve', /^\/mem due-policy-approve ([A-Za-z0-9._-]+)$/],
  ['due-confirm', /^\/mem due-confirm ([a-z0-9_]+) (\d+) ([0-9a-f]{16,64})$/],
  ['due-restore', /^\/mem due-restore ([a-z0-9_]+) (\d+)$/],
  ['due-done', /^\/mem due-done ([a-z0-9_]+) (\d+) (done|dropped)$/],
  ['due-mention', /^\/mem due-mention ([a-z0-9_]+) (\d+)$/],
  ['due-batch', /^\/mem due-batch ([a-z0-9_:.-]+) ([0-9a-f]{16,64})$/],
];

export function parseOwnerDueCommand(text) {
  if (typeof text !== 'string') return null;
  for (const [command, pattern] of COMMANDS) {
    const match = pattern.exec(text.trim());
    if (match) return { command, args: match.slice(1) };
  }
  return null;
}

export function duePayloadHash(memoryId, revision) {
  return payloadHash({ memoryId, revision, policy: POLICY_REVISION });
}

function dueStateKey(memoryId) {
  return `due:${memoryId}`;
}

function readDueProjection(db, memoryId) {
  return getState(db, dueStateKey(memoryId))?.value ?? null;
}

export function checkDueCapacity(db, { H = null, limits = P_LIMITS, targetBytes = 0, targetMembers = 1 } = {}) {
  const rows = db
    .prepare("SELECT id, text, due_state FROM memories WHERE due_state = 'open' ORDER BY id")
    .all();
  if (H === null) {
    return { ok: false, reason: 'capacity_unknown', code: 'capacity_unknown', members: rows.length, bytes: 0, limits, H };
  }
  const members = rows.length + targetMembers;
  const hardBytes = 4096; // K + fixed hard layer estimate
  const bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(row.text, 'utf8'), 0) + targetBytes + hardBytes;
  const memberRatio = members / limits.members;
  const byteRatio = bytes / limits.bytes;
  const tokenRatio = H === null ? null : (bytes / 2) / (limits.hRatio * H);
  const blocked =
    members > limits.members ||
    bytes > limits.bytes ||
    (tokenRatio !== null && tokenRatio > 1);
  return {
    ok: !blocked,
    members,
    bytes,
    limits,
    H,
    ratios: { members: memberRatio, bytes: byteRatio, tokens: tokenRatio },
    warning: memberRatio >= 0.8 || byteRatio >= 0.8 || (tokenRatio !== null && tokenRatio >= 0.8),
    reason: blocked
      ? members > limits.members
        ? 'members_limit'
        : bytes > limits.bytes
          ? 'bytes_limit'
          : 'token_limit'
      : null,
  };
}

/** Owner-approved policy gate: open is unavailable until due-policy-v1 is approved. */
export function approveDuePolicy(deps, { policyRevision = POLICY_REVISION, receiptId = null, by = null } = {}) {
  const { main: db, clock } = deps;
  return withImmediate(db, () => {
    putState(
      db,
      `due-policy:${policyRevision}`,
      { approved: true, revision: policyRevision, receiptId, approvedAt: clock.at().at },
      1,
    );
    appendRelation(db, {
      type: 'due-policy-approve',
      payload: by === null ? { policyRevision, receiptId } : { policyRevision, receiptId, by },
      businessKey: policyRevision,
      at: clock.at().at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
    return { ok: true, policyRevision };
  });
}

function transition(deps, { memoryId, from, to, reason, receiptId = null, reportId = null, triggerId = null, evidenceRefs = [] }) {
  const { main: db, clock } = deps;
  const memory = getMemory(db, memoryId);
  if (!memory) return { ok: false, code: 'due_missing' };
  const queue = db.prepare('SELECT * FROM due_queue WHERE memory_id = ?').get(memoryId);
  const baseRevision = Number(queue?.revision ?? 0);
  const revision = baseRevision + 1;
  const at = clock.at().at;
  const dueProjection = {
    ownerIdentity: 'owner',
    enqueued_seq: Number(queue?.enqueued_seq ?? 0),
    enqueued_at: queue?.enqueued_at ?? null,
    opened_at: to === 'open' ? at : readDueProjection(db, memoryId)?.opened_at ?? null,
    last_due_mention_at: readDueProjection(db, memoryId)?.last_due_mention_at ?? null,
    deadline_at: queue?.deadline_at ?? null,
    lastEvidenceVersion: memory.payload_hash,
    archived_reason: to === 'shelved-due' || to === 'cooled-due' ? reason : null,
  };
  const payload = {
    memoryId,
    baseRevision,
    revision,
    from,
    to,
    reason,
    evidence_refs: evidenceRefs,
    policyRevision: POLICY_REVISION,
    receiptId,
    triggerId,
    reportId,
    dueProjection,
  };
  const receipt = commitControlled({
    control: deps.control,
    clock,
    spec: {
      objectKey: `main:due:${memoryId}`,
      targetDb: 'main',
      requestKey: `due-state:${canonicalJson([memoryId, triggerId ?? receiptId ?? reason, baseRevision])}`,
      payloadHash: payloadHash(payload),
      immutablePayload: canonicalJson(payload),
      targetIds: [memoryId],
      expected: { kind: 'due', payloadHash: payloadHash(payload) },
      actual: () => ({
        row: db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId),
        events: db
          .prepare("SELECT payload FROM relations WHERE type = 'due-state' AND json_extract(payload, '$.memoryId') = ?")
          .all(memoryId)
          .map((row) => ({ type: 'due-state', hash: payloadHash(JSON.parse(row.payload)) })),
      }),
      hooks: deps.commitHooks ?? {},
    },
    writeTxn: () =>
      withImmediate(db, () => {
        appendRelation(db, {
          type: 'due-state',
          payload,
          businessKey: canonicalJson([memoryId, triggerId ?? receiptId ?? reason, baseRevision]),
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
        const doneAt = to === 'done' ? at : null;
        db.prepare('UPDATE memories SET due_state = ?, due_done_at = ? WHERE id = ?').run(to, doneAt, memoryId);
        db.prepare(
          `INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(memory_id) DO UPDATE SET
             due_state = excluded.due_state, opened_at = COALESCE(excluded.opened_at, due_queue.opened_at),
             revision = excluded.revision, reason = excluded.reason`,
        ).run(
          memoryId,
          to,
          dueProjection.enqueued_seq,
          queue?.enqueued_at ?? at,
          dueProjection.opened_at,
          queue?.deadline_at ?? null,
          revision,
          reason,
        );
        putState(
          db,
          dueStateKey(memoryId),
          {
            ...dueProjection,
            state: to,
            revision,
          },
          revision,
        );
        if (receiptId) consumeReceipt(db, clock, receiptId);
      }),
    readExact: () => {
      const stored = getMemory(db, memoryId);
      const projection = readDueProjection(db, memoryId);
      if (!stored || stored.due_state !== to) return { status: 'unknown', reason: 'due_projection_mismatch' };
      if (projection?.revision !== revision) return { status: 'unknown', reason: 'due_state_missing' };
      return { status: 'found', row: stored };
    },
  });
  if (receipt.status !== 'found') return { ok: false, code: receipt.readback?.reason ?? 'readback_not_found' };
  return { ok: true, revision, to };
}

function appendReport(db, clock, { items, reportId, sourceRevision }) {
  appendRelation(db, {
    type: 'due-report',
    payload: {
      reportId,
      policyRevision: POLICY_REVISION,
      sourceRevision,
      items,
      payloadHash: payloadHash(items),
      notification: 'unknown',
    },
    businessKey: reportId,
    at: clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
}

/**
 * Whole-message owner commands only. Each one issues a binding receipt first and
 * executes inside the same main transaction; a model free sentence is not a command.
 */
export function handleOwnerDueCommand(deps, { text, inputEventId, ownerId = 'owner' }) {
  const { main: db, clock } = deps;
  const parsed = parseOwnerDueCommand(text);
  if (!parsed) return { ok: false, code: 'not_a_due_command' };
  const { command, args } = parsed;

  if (command === 'due-policy-approve') {
    const [policyRevision] = args;
    if (policyRevision !== POLICY_REVISION) return { ok: false, code: 'validation_error' };
    const receipt = withImmediate(db, () =>
      issueReceipt(db, clock, {
        ownerId,
        proposalId: `due-policy:${policyRevision}`,
        action: 'due-policy-approve',
        payloadHash: payloadHash({ policyRevision }),
        targetIds: [],
        baseVersions: [],
        nonce: `nonce-${inputEventId}`,
        inputEventId,
      }),
    );
    // The owner channel is the only caller; record it on the audit row.
    return approveDuePolicy(deps, { policyRevision, receiptId: receipt.receiptId, by: 'owner' });
  }

  if (command === 'due-batch') {
    return { ok: false, code: 'unsupported_in_batch', rule: 'batch_execution_not_open' };
  }

  const memoryId = args[0];
  const revision = Number(args[1]);
  const memory = getMemory(db, memoryId);
  if (!memory) return { ok: false, code: 'due_missing' };
  const queue = db.prepare('SELECT * FROM due_queue WHERE memory_id = ?').get(memoryId);
  if (!queue || Number(queue.revision) !== revision) {
    return { ok: false, code: 'stale_proposal', revision: Number(queue?.revision ?? 0) };
  }

  if (command === 'due-confirm') {
    const providedHash = args[2];
    if (providedHash !== duePayloadHash(memoryId, revision)) {
      return { ok: false, code: 'due_hash_mismatch' };
    }
    if (memory.due_state !== 'pending-due') return { ok: false, code: 'stale_proposal', state: memory.due_state };
    if (!duePolicyState(db)?.approved) return { ok: false, code: 'policy_not_approved' };
    const capacity = checkDueCapacity(db, {
      H: deps.H ?? null,
      limits: deps.dueLimits ?? P_LIMITS,
      targetBytes: Buffer.byteLength(memory.text, 'utf8') + 256,
      targetMembers: 1,
    });
    if (!capacity.ok) {
      return { ok: false, code: capacity.reason === 'capacity_unknown' ? 'capacity_unknown' : 'due_capacity_blocked', capacity };
    }
    const receipt = withImmediate(db, () =>
      issueReceipt(db, clock, {
        ownerId,
        proposalId: `due-confirm:${memoryId}:${revision}`,
        action: 'due-confirm',
        payloadHash: providedHash,
        targetIds: [memoryId],
        baseVersions: [revision],
        nonce: `nonce-${inputEventId}`,
        inputEventId,
      }),
    );
    const reportId = objectId('due-report', canonicalJson([memoryId, revision, 'confirm']));
    const result = transition(deps, {
      memoryId,
      from: 'pending-due',
      to: 'open',
      reason: 'owner_confirm',
      receiptId: receipt.receiptId,
      reportId,
      triggerId: inputEventId,
    });
    if (result.ok) {
      appendReport(db, clock, {
        reportId,
        sourceRevision: revision,
        items: [{ memoryId, from: 'pending-due', to: 'open', action: 'confirm', baseRevision: revision, reason: 'owner_confirm' }],
      });
    }
    return result;
  }

  if (command === 'due-restore') {
    const allowed = ['shelved-due', 'pending-done', 'cooled-due'];
    if (!allowed.includes(memory.due_state)) return { ok: false, code: 'invalid_transition', state: memory.due_state };
    if (!duePolicyState(db)?.approved) return { ok: false, code: 'policy_not_approved' };
    const capacity = checkDueCapacity(db, {
      H: deps.H ?? null,
      limits: deps.dueLimits ?? P_LIMITS,
      targetBytes: Buffer.byteLength(memory.text, 'utf8') + 256,
      targetMembers: 1,
    });
    if (!capacity.ok) {
      return { ok: false, code: capacity.reason === 'capacity_unknown' ? 'capacity_unknown' : 'due_capacity_blocked', capacity };
    }
    const receipt = verifyReceipt0(db, clock, { ownerId, inputEventId, memoryId, revision, action: 'due-restore' });
    if (!receipt.ok) return receipt;
    if (memory.due_state === 'shelved-due') {
      const deadline = new Date(Date.parse(clock.at().at) + 14 * 24 * 60 * 60 * 1000).toISOString();
      const nextSeq = Number(
        db.prepare('SELECT COALESCE(MAX(enqueued_seq), 0) + 1 AS n FROM due_queue').get().n,
      );
      const result = transition(deps, {
        memoryId,
        from: 'shelved-due',
        to: 'pending-due',
        reason: 'owner_restore_pending',
        receiptId: receipt.receiptId,
        triggerId: inputEventId,
      });
      if (!result.ok) return result;
      db.prepare('UPDATE due_queue SET deadline_at = ?, enqueued_seq = ? WHERE memory_id = ?').run(deadline, nextSeq, memoryId);
      return { ...result, state: 'pending-due' };
    }
    return transition(deps, {
      memoryId,
      from: memory.due_state,
      to: 'open',
      reason: 'owner_restore',
      receiptId: receipt.receiptId,
      triggerId: inputEventId,
    });
  }

  if (command === 'due-done') {
    const how = args[2];
    if (!['open', 'pending-done', 'cooled-due'].includes(memory.due_state)) {
      return { ok: false, code: 'invalid_transition', state: memory.due_state };
    }
    const receipt = verifyReceipt0(db, clock, { ownerId, inputEventId, memoryId, revision, action: 'due-done' });
    if (!receipt.ok) return receipt;
    return transition(deps, {
      memoryId,
      from: memory.due_state,
      to: how,
      reason: `owner_${how}`,
      receiptId: receipt.receiptId,
      triggerId: inputEventId,
    });
  }

  if (command === 'due-mention') {
    return withImmediate(db, () => {
      appendRelation(db, {
        type: 'due-mention',
        payload: { memoryId, ownerInputId: inputEventId, receiptId: null },
        businessKey: canonicalJson([memoryId, inputEventId]),
        at: clock.at().at,
        keyEncoding: 'canonical',
        eventVersion: '2',
        payloadVersion: '2',
      });
      const projection = readDueProjection(db, memoryId);
      if (projection) {
        putState(
          db,
          dueStateKey(memoryId),
          { ...projection, last_due_mention_at: clock.at().at },
          Number(projection.revision ?? 0),
        );
      }
      return { ok: true, memoryId, mentioned: true };
    });
  }

  return { ok: false, code: 'unsupported_in_batch', command };
}

function verifyReceipt0(db, clock, { ownerId, inputEventId, memoryId, revision, action }) {
  const issued = withImmediate(db, () =>
    issueReceipt(db, clock, {
      ownerId,
      proposalId: `${action}:${memoryId}:${revision}`,
      action,
      payloadHash: payloadHash({ memoryId, revision, action }),
      targetIds: [memoryId],
      baseVersions: [revision],
      nonce: `nonce-${inputEventId}`,
      inputEventId,
    }),
  );
  const verified = verifyReceipt(db, { receiptId: issued.receiptId, action });
  if (!verified.ok) return verified;
  return { ok: true, receiptId: issued.receiptId };
}

export { transition };

/**
 * Retreat is intentionally unreachable until due-policy-v1 is truly approved.
 * Even then this build only reports; it never moves items behind the owner's back.
 */
export function requestDueRetreat(db) {
  const approved = Boolean(duePolicyState(db)?.approved);
  return {
    ok: false,
    code: 'due_retreat_unavailable',
    reason: approved ? 'retreat_not_implemented_after_approval' : 'policy_not_approved',
  };
}
