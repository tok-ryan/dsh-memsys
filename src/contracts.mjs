/**
 * Field enums, defaults, request validation and response contracts.
 * Nothing here may be relaxed by a model parameter.
 */

export const OBSERVATION_SOURCES = ['conversation', 'tool', 'file', 'dream', 'correction', 'model'];
export const AUTHOR_KINDS = ['owner', 'tool', 'file', 'model', 'unknown'];
export const MEMORY_TYPES = [
  'identity', 'preference', 'promise', 'episode', 'fact', 'emotion', 'procedure',
];
export const SCENES = ['work', 'life', 'both'];
export const SCOPES = ['global', 'work-only', 'life-only'];
export const SEMANTIC_STATUSES = ['quoted', 'proposed', 'accepted'];
export const RECORD_KINDS = ['assertion', 'utterance'];
export const TIME_STATES = ['point', 'exact', 'ongoing', 'ended_unknown'];
export const PRECISIONS = ['minute', 'day', 'month', 'year', 'unknown'];
export const DUE_STATES = [
  'none', 'pending-due', 'shelved-due', 'open', 'pending-done', 'cooled-due', 'done', 'dropped',
];
export const CANDIDATE_STATUSES = [
  'pending', 'conflicted', 'promoted', 'rejected', 'demoted', 'shelved',
];
export const SOURCE_PATHS = ['capture', 'tool', 'block', 'dream', 'resolve', 'confirm'];
export const EVIDENCE_ROLES = ['basis', 'derived'];
export const POINTER_STATUSES = ['exact', 'unknown'];
export const FACT_STATES = ['active', 'superseded', 'corrected', 'retired'];
export const CREDIBILITY_LEVELS = ['verified', 'unverified', 'from-dream'];
export const OPERATION_STATUSES = [
  'reserved', 'found', 'failed', 'frozen', 'reconciled', 'unfrozen',
];
export const REVIEW_POLICIES = ['capture-v1', 'candidate-v1', 'due-policy-v1'];

export const DEFAULTS = Object.freeze({
  weight: 5,
  confidence: 0.5,
  lossy: 0,
  timeState: 'point',
  precision: 'unknown',
  dueState: 'none',
  semanticStatus: 'proposed',
  recordKind: 'assertion',
  pointerStatus: 'unknown',
  sourcePath: 'tool',
  reviewPolicy: 'candidate-v1',
  policyRevision: '1',
  textSummaryCodePoints: 80,
});

/** initial-v1: ordering seed only, never a psychological measurement. */
export function initialStrength(input = {}) {
  const energy = input.energy ?? 'unknown';
  const emotion = input.emotionStrength ?? 'unknown';
  const energyDelta = { high: 0.1, normal: 0, low: -0.1, unknown: 0 }[energy];
  const emotionDelta = { strong: 0.1, normal: 0, unknown: 0 }[emotion];
  if (energyDelta === undefined) throw new TypeError('invalid_energy');
  if (emotionDelta === undefined) throw new TypeError('invalid_emotion_strength');
  const raw = 0.5 + energyDelta + emotionDelta;
  return Math.min(1, Math.max(0, raw));
}

/** Immutable per-object admission snapshot (design §3.2). */
export function buildStateSnapshot({ runtime, clock, energy, emotion, emotionStrength } = {}) {
  const reading = clock.at();
  return Object.freeze({
    captured_at: reading.at,
    phase: runtime?.phase ?? 'unknown',
    session_id: runtime?.sessionId ?? null,
    round_id: runtime?.roundId ?? null,
    active_project_id: runtime?.activeProjectId ?? null,
    energy: energy ?? 'unknown',
    emotion: emotion ?? 'unknown',
    state_source_refs: [],
    strength_policy: 'initial-v1',
    emotion_strength: emotionStrength ?? 'unknown',
    clock_anomaly: reading.anomaly === null ? null : reading.anomaly.kind,
  });
}

export function assertEnum(name, allowed, value) {
  if (!allowed.includes(value)) {
    const err = new TypeError(`invalid_${name}:${String(value)}`);
    err.code = `invalid_${name}`;
    throw err;
  }
  return value;
}

export function assertNonEmptyString(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    const err = new TypeError(`invalid_${name}`);
    err.code = `invalid_${name}`;
    throw err;
  }
  return value;
}

export function validateObservationEnvelope(envelope = {}) {
  assertNonEmptyString('observation_text', envelope.text);
  assertEnum('source', OBSERVATION_SOURCES, envelope.source ?? 'conversation');
  assertEnum('author_kind', AUTHOR_KINDS, envelope.authorKind ?? 'owner');
  assertNonEmptyString('origin', envelope.origin);
  if (!envelope.runtime || typeof envelope.runtime !== 'object') {
    throw new TypeError('invalid_runtime');
  }
  assertNonEmptyString('session_id', envelope.runtime.sessionId);
  return {
    text: envelope.text,
    source: envelope.source ?? 'conversation',
    authorKind: envelope.authorKind ?? 'owner',
    origin: envelope.origin,
    lossy: envelope.lossy === true ? 1 : 0,
    runtime: envelope.runtime,
    runtimeRefs: envelope.runtimeRefs ?? {},
  };
}

export function validateCandidateInput(item = {}) {
  assertNonEmptyString('candidate_text', item.text);
  assertNonEmptyString('candidate_why', item.why);
  assertEnum('type', MEMORY_TYPES, item.type);
  assertEnum('scene', SCENES, item.scene);
  assertEnum('scope', SCOPES, item.scope);
  assertEnum('semantic_status', SEMANTIC_STATUSES, item.semanticStatus ?? DEFAULTS.semanticStatus);
  assertEnum('record_kind', RECORD_KINDS, item.recordKind ?? DEFAULTS.recordKind);
  assertEnum('time_state', TIME_STATES, item.timeState ?? DEFAULTS.timeState);
  if (item.weight !== undefined && (typeof item.weight !== 'number' || item.weight < 0 || item.weight > 10)) {
    throw new TypeError('invalid_weight');
  }
  return item;
}

export function toolError(code, message, extra = {}) {
  return {
    status: 'error',
    code,
    message,
    retryable: extra.retryable === true,
    unresolved_ids: extra.unresolvedIds ?? [],
    clock: extra.clock ?? null,
  };
}

export const UNSUPPORTED_IN_BATCH = 'unsupported_in_batch';
export const UNSUPPORTED_FEATURE = 'unsupported_feature';

export const SELF_OBJECT_KINDS = Object.freeze(['self_note', 'judgment', 'speculation']);
export const SELF_AUTHOR_ROLES = Object.freeze(['daily', 'dream']);
export const SELF_NOTE_FORBIDDEN_FIELDS = Object.freeze([
  'author',
  'author_runtime',
  'authorRuntime',
  'role',
  'origin',
  'credibility',
  'semantic_status',
  'semanticStatus',
  'due_state',
  'dueState',
  'truth',
]);
export const SELF_NOTE_BATCH1_DEPENDENCY = 'dependency_unavailable';
