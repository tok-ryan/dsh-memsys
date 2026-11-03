import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { keys, objectId, payloadHash } from '../identity.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactObservation } from '../control/readback.mjs';
import { appendRelation, getObservation, insertObservation } from '../storage/repositories.mjs';
import { withImmediate } from '../storage/open.mjs';
import { WriteError, assertDailyRuntime } from './authority.mjs';
import { captureObservation } from './capture.mjs';

/**
 * Observation write path: the original words are committed and read back
 * independently BEFORE any candidate work. Later failures never roll this back.
 */

export function buildObservationRow(runtime, clock, { text, source, authorKind, origin, messageKey, lossy = 0 }) {
  const at = clock.at().at;
  const immutable = { text, source, authorKind, origin };
  return {
    id: objectId('obs', messageKey),
    idempotency_key: messageKey,
    at,
    payload_hash: payloadHash(immutable),
    text,
    source,
    author_kind: authorKind,
    runtime_refs: JSON.stringify({
      sessionId: runtime.sessionId,
      roundId: runtime.roundId ?? null,
      messageSeq: runtime.messageSeq ?? null,
      callId: runtime.callId ?? null,
    }),
    origin,
    lossy,
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
    initial_strength: initialStrength(),
    recorded_at: at,
  };
}

/** Per-identity persistent input counter; duplicate log events never advance it. */
export function currentInputSeq(db, identity) {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(`input-seq:${identity}`);
  if (!row) return 0;
  return Number(JSON.parse(row.value).value ?? 0);
}

export function advanceInputSeq(db, identity, messageKey) {
  const key = `input-seq:${identity}`;
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key);
  const state = row ? JSON.parse(row.value) : { value: 0, seen: {} };
  if (state.seen[messageKey] !== undefined) return { value: Number(state.value), advanced: false };
  const next = Number(state.value) + 1;
  state.value = next;
  state.seen[messageKey] = next;
  // Keep the dedupe window bounded; ordering is by input sequence.
  const entries = Object.entries(state.seen).sort((a, b) => b[1] - a[1]).slice(0, 500);
  state.seen = Object.fromEntries(entries);
  db.prepare(
    `INSERT INTO state (key, value, source_revision) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, source_revision = excluded.source_revision`,
  ).run(key, JSON.stringify(state), next);
  return { value: next, advanced: true };
}

export function inputSeqOf(main, identity) {
  return currentInputSeq(main, identity);
}

/**
 * Path A observation entry. Must be driven by a real trusted user message; it
 * never waits for assistant output, turn end or a model JSON block.
 */
export function observeInput(runtime, envelope, deps) {
  assertDailyRuntime(runtime);
  const { main, control, clock } = deps;
  const text = envelope?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new WriteError('validation_error', { field: 'text' });
  }
  const source = envelope.source ?? 'conversation';
  if (source !== 'conversation') {
    throw new WriteError('validation_error', { field: 'source', rule: 'batch1_conversation_only' });
  }
  const messageSeq = envelope.messageSeq ?? runtime.messageSeq ?? envelope.logPosition;
  if (messageSeq === undefined || messageSeq === null) {
    throw new WriteError('validation_error', { field: 'message_seq' });
  }
  const messageKey = keys.observationConversation(runtime.identity, runtime.sessionId, messageSeq);
  const origin = `master@${clock.localDate()}`;
  const row = buildObservationRow(runtime, clock, {
    text,
    source: 'conversation',
    authorKind: 'owner',
    origin,
    messageKey,
  });
  const spec = {
    objectKey: `main:${row.id}`,
    targetDb: 'main',
    requestKey: `observe:${messageKey}`,
    payloadHash: row.payload_hash,
    immutablePayload: JSON.stringify({ text, source: 'conversation', authorKind: 'owner', origin }),
    targetIds: [row.id],
    expected: {
      kind: 'observation',
      payloadHash: row.payload_hash,
      canonicalHash: payloadHash({ text, source: 'conversation', authorKind: 'owner', origin }),
    },
    actual: () => ({ row: getObservation(main, row.id) }),
    hooks: deps.commitHooks ?? {},
  };
  const runtimeRef = {
    identity: runtime.identity ?? null,
    sessionId: runtime.sessionId ?? null,
    roundId: runtime.roundId ?? null,
    messageSeq: runtime.messageSeq ?? messageSeq ?? null,
    callId: runtime.callId ?? null,
    mode: runtime.mode === 'life' ? 'life' : 'work',
  };
  const jobScope = runtimeRef.mode === 'life' ? 'life-only' : 'work-only';
  const writeTxn = () =>
    withImmediate(main, () => {
      if (getObservation(main, row.id)) return;
      insertObservation(main, row);
      appendRelation(main, {
        type: 'capture-job',
        payload: { observationId: row.id, status: 'pending', ...runtimeRef, scope: jobScope },
        businessKey: row.id,
        at: row.at,
      });
      advanceInputSeq(main, runtime.identity, messageKey);
    });
  const receipt = commitControlled({
    control,
    clock,
    spec,
    writeTxn,
    readExact: () => readExactObservation(main, row),
  });
  return {
    observation: getObservation(main, row.id),
    receipt,
    replayed: receipt.replayed === true,
  };
}

/** Path A orchestration: observation first, then capture; never output-dependent. */
export function ingestInput(runtime, envelope, deps) {
  const observed = observeInput(runtime, envelope, deps);
  if (observed.receipt.status !== 'found') {
    return { ...observed, capture: null, memory: null };
  }
  const captured = captureObservation(runtime, observed.observation.id, deps);
  return {
    ...observed,
    capture: captured.capture,
    memory: captured.memory,
    captureReceipt: captured.receipt,
  };
}
