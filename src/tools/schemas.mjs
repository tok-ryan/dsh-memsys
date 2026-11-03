/**
 * Tool JSON schema and field whitelists. Runtime identity/session/round/callId
 * are bound outside the model-fillable schema.
 */

export const RECORD_KINDS_BATCH1 = Object.freeze([
  'self_note',
  'judgment',
  'speculation',
  'outcome_change',
  'verdict',
  'needs_review',
  'project_update',
  'candidate',
  'promote_candidate',
  'reject_candidate',
  'propose_owner_action',
  'feedback',
  'timeline_change',
  'pointer_change',
]);

export const RECORD_KINDS_UNSUPPORTED = Object.freeze([
  'dream',
  'registered_tool_outcome',
]);

export const MEMORY_TYPE_ENUM = Object.freeze([
  'identity', 'preference', 'promise', 'episode', 'fact', 'emotion', 'procedure',
]);

export const RECORD_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    observationId: { type: 'string', minLength: 1 },
    sourceUnit: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
    detail: { type: ['string', 'null'] },
    why: { type: 'string', minLength: 1 },
    type: { enum: [...MEMORY_TYPE_ENUM] },
    scene: { enum: ['work', 'life', 'both'] },
    scope: { enum: ['global', 'work-only', 'life-only'] },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    structuredValue: {},
    weight: { type: 'number', minimum: 0, maximum: 10 },
    evidenceRefs: { type: 'array', items: { type: 'object' } },
    topicComponents: { type: 'object' },
    entityMention: { type: 'object' },
    time: { type: 'object' },
    dueAt: { type: ['string', 'null'] },
    dueEvidenceRef: { type: 'string' },
    candidateId: { type: 'string' },
    baseRevision: { type: 'string' },
    reason: { type: 'string' },
  },
  required: [],
});

export const RECORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'items'],
  properties: {
    kind: { enum: [...RECORD_KINDS_BATCH1, ...RECORD_KINDS_UNSUPPORTED] },
    request_id: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: RECORD_ITEM_SCHEMA,
    },
  },
});

export function validateRecordRequest(request) {
  const errors = [];
  if (!request || typeof request !== 'object') {
    return { ok: false, errors: ['request_not_object'] };
  }
  if (!RECORD_KINDS_BATCH1.includes(request.kind) && !RECORD_KINDS_UNSUPPORTED.includes(request.kind)) {
    errors.push(`unknown_kind:${request.kind}`);
  }
  if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 20) {
    errors.push('items_must_be_1_to_20');
  }
  for (const [index, item] of (request.items ?? []).entries()) {
    if (!item || typeof item !== 'object') errors.push(`item_${index}_not_object`);
  }
  return { ok: errors.length === 0, errors };
}

export const READ_SCHEMAS = Object.freeze({
  memsys_get: {
    type: 'object',
    additionalProperties: false,
    required: ['ids'],
    properties: {
      ids: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1 } },
      view: { enum: ['current', 'history'] },
      include_evidence: { type: 'boolean' },
      cursor: { type: ['string', 'null'] },
      max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
    },
  },
  memsys_search: {
    type: 'object',
    additionalProperties: false,
    properties: {
      keywords: { type: 'string' },
      scene: { enum: ['work', 'life', 'both'] },
      topic_key: { type: 'string' },
      time_range: { type: 'object' },
      graph: { type: 'object' },
      cursor: { type: ['string', 'null'] },
      max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
    },
  },
  memsys_review_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ids: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
      kind: { enum: ['candidate', 'pending', 'due-history'] },
      cursor: { type: ['string', 'null'] },
      max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
    },
  },
  memsys_context_get: {
    type: 'object',
    additionalProperties: false,
    required: ['snapshot_revision', 'group_id'],
    properties: {
      snapshot_revision: { type: 'string', minLength: 1 },
      group_id: { type: 'string', minLength: 1 },
      cursor: { type: ['string', 'null'] },
      max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
      view: { enum: ['current', 'history'] },
    },
  },
});

const TOOL_SCHEMA_MAP = Object.freeze({
  ...READ_SCHEMAS,
  memsys_record: RECORD_SCHEMA,
});

export function validateToolArgs(name, args) {
  const schema = TOOL_SCHEMA_MAP[name];
  if (!schema) return { ok: false, errors: ['unknown_tool'] };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, errors: ['args_not_object'] };
  }
  const errors = [];
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) errors.push('unknown_field:' + key);
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) errors.push('missing_field:' + key);
  }
  if (args.ids !== undefined) {
    if (!Array.isArray(args.ids) || args.ids.length < 1 || args.ids.length > 10) {
      errors.push('ids_must_be_1_to_10');
    } else if (new Set(args.ids).size !== args.ids.length) {
      errors.push('ids_must_be_unique');
    }
  }
  if (args.max_chars !== undefined) {
    const value = args.max_chars;
    if (!Number.isInteger(value) || value < 1000 || value > 16000) errors.push('max_chars_out_of_range');
  }
  if (args.view !== undefined && !['current', 'history'].includes(args.view)) errors.push('invalid_view');
  return { ok: errors.length === 0, errors };
}

export const BATCH1_TOOL_SCHEMAS = TOOL_SCHEMA_MAP;
