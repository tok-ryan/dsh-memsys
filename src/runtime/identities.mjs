import { keys } from '../identity.mjs';
import { putState, getState } from '../storage/repositories.mjs';

/**
 * Stable runtime identity mapping. A model can never supply identity, role,
 * session or message sequence; the adapter derives them from the trusted host.
 */
export function runtimeIdentity({ sessionId, turn = 0, step = 0, phase = 'work', role = 'daily' }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('invalid_session_id');
  }
  return Object.freeze({
    identity: 'owner',
    sessionId,
    turn: Number(turn),
    step: Number(step),
    roundId: `${sessionId}:${Number(turn)}`,
    phase,
    mode: phase === 'life' ? 'life' : 'work',
    role,
  });
}

export function messageBusinessKey({ identity = 'owner', sessionId, messageSeq }) {
  return keys.observationConversation(identity, sessionId, messageSeq);
}

/** Persist the consumed log cursor so a restart resumes without double-counting. */
export function persistCursor(main, { sessionId, seq, turn }) {
  const key = `runtime:cursor:${sessionId}`;
  const existing = getState(main, key);
  const previousSeq = Number(existing?.value?.seq ?? 0);
  if (Number(seq) < previousSeq) {
    return { advanced: false, reason: 'clock_backwards_cursor' };
  }
  putState(
    main,
    key,
    { seq: Number(seq), turn: Number(turn), updatedAt: new Date().toISOString() },
    Number(seq),
  );
  return { advanced: true, seq: Number(seq) };
}

export function loadCursor(main, sessionId) {
  return getState(main, `runtime:cursor:${sessionId}`)?.value ?? null;
}
