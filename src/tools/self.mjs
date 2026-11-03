import { selfGet } from '../read/self.mjs';

export const SELF_GET_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: ['self_note', 'judgment', 'speculation'] },
    ids: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    view: { enum: ['current', 'history'] },
    cursor: { type: ['string', 'null'] },
    max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
  },
});

export function validateSelfArgs(args = {}) {
  const errors = [];
  const allowed = new Set(['kind', 'ids', 'view', 'cursor', 'max_chars']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) errors.push(`unknown_field:${key}`);
  if (!['self_note', 'judgment', 'speculation'].includes(args.kind)) errors.push('invalid_kind');
  if (args.ids !== undefined) {
    if (!Array.isArray(args.ids) || args.ids.length < 1 || args.ids.length > 10) {
      errors.push('ids_must_be_1_to_10');
    } else if (new Set(args.ids).size !== args.ids.length) {
      errors.push('ids_must_be_unique');
    }
  }
  if (args.view !== undefined && !['current', 'history'].includes(args.view)) errors.push('invalid_view');
  if (args.max_chars !== undefined) {
    const value = args.max_chars;
    if (!Number.isInteger(value) || value < 1000 || value > 16000) errors.push('max_chars_out_of_range');
  }
  return { ok: errors.length === 0, errors };
}

export function createSelfHandler({ main, clock }) {
  return {
    get(args = {}) {
      const validation = validateSelfArgs(args);
      if (!validation.ok) {
        return { status: 'error', code: 'validation_error', errors: validation.errors, clock: clock.at().at };
      }
      return selfGet({
        main,
        clock,
        kind: args.kind,
        ids: args.ids ?? null,
        view: args.view ?? 'current',
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
      });
    },
  };
}
