/**
 * Runtime role and permission boundaries. Nothing here may be satisfied by a
 * model-supplied parameter: the role comes from the trusted runtime only.
 */

export const UNSUPPORTED_IN_BATCH = 'unsupported_in_batch';

export class WriteError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Batch 1 only accepts the daily write role. */
export function assertDailyRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new WriteError('invalid_runtime');
  if (runtime.role !== 'daily') {
    throw new WriteError('invalid_role', { role: runtime.role ?? null });
  }
  if (!runtime.identity || !runtime.sessionId) {
    throw new WriteError('invalid_runtime_identity');
  }
  return runtime;
}

/** Owner-only actions are closed in batch 1; never fake an executed action. */
export const OWNER_ACTIONS = Object.freeze([
  'demote',
  'corrected',
  'due-open',
  'due-confirm',
  'due-done',
  'due-restore',
  'supersede',
  'rekey',
  'register-entity',
  'register-alias',
  'merge-entity',
  'scene-expand',
  'project-create',
  'project-select',
  'confirm-dream',
  'master-verdict',
]);

export function rejectUnsupportedBatch(feature, detail = {}) {
  throw new WriteError(UNSUPPORTED_IN_BATCH, { feature, ...detail });
}

/** Fields a model request may never supply (origin, binding, authority, audit time). */
export const FORBIDDEN_MODEL_FIELDS = Object.freeze([
  'origin',
  'credibility',
  'topic_key',
  'topicKey',
  'author',
  'author_kind',
  'authorKind',
  'by',
  'master',
  'semantic_status',
  'semanticStatus',
  'due_state',
  'dueState',
  'truth',
]);

export const AUDIT_TIME_FIELDS = Object.freeze([
  'at',
  'recorded_at',
  'recordedAt',
  'observed_at',
  'observedAt',
  'promoted_at',
  'promotedAt',
  'created_at',
  'createdAt',
  'last_touched_at',
  'lastTouchedAt',
]);

/** Audit times are system-generated; model values are dropped and reported. */
export function stripAuditTimes(item) {
  const violations = [];
  const clean = { ...item };
  for (const field of AUDIT_TIME_FIELDS) {
    if (clean[field] !== undefined) {
      violations.push(field);
      delete clean[field];
    }
  }
  return { item: clean, violations };
}

export function assertNoForbiddenFields(item) {
  const found = FORBIDDEN_MODEL_FIELDS.filter((field) => item[field] !== undefined);
  if (found.length > 0) {
    throw new WriteError('validation_error', { forbidden_fields: found });
  }
  return true;
}

/** Model origin token: always unverified when folded. */
export function modelOrigin(runtime) {
  const call = runtime.callId ?? runtime.requestId ?? runtime.roundId ?? 'call';
  const agent = runtime.agentId ?? runtime.agent_id ?? '';
  return `model:${agent}:${runtime.sessionId}:${call}`;
}

/** A model may only reject its own untouched pending candidate. */
export function assertOwnPendingCandidate(runtime, candidate) {
  if (!candidate) throw new WriteError('candidate_missing');
  if (candidate.creator_session_id !== runtime.sessionId) {
    throw new WriteError('reject_outside_session');
  }
  if (Number(candidate.owner_touched) === 1) {
    throw new WriteError('reject_owner_touched');
  }
  if (candidate.status !== 'pending') {
    throw new WriteError('reject_not_pending', { status: candidate.status });
  }
  return true;
}

export function violationEventPayload(runtime, violations) {
  return {
    kind: 'audit_time_rejected',
    fields: violations,
    sessionId: runtime.sessionId,
    requestId: runtime.requestId ?? null,
  };
}

export const MODEL_AUTHOR_ROLES = Object.freeze(['daily', 'dream']);

/** Judgment / speculation authors are the trusted daily or dream model only. */
export function assertModelAuthor(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new WriteError('invalid_runtime');
  if (!MODEL_AUTHOR_ROLES.includes(runtime.role)) {
    throw new WriteError('invalid_role', { role: runtime.role ?? null });
  }
  if (!runtime.sessionId || !runtime.callId || !runtime.identity) {
    throw new WriteError('runtime_identity_unavailable');
  }
  return runtime;
}
