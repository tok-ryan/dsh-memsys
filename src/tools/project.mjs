import { projectGet } from '../read/project.mjs';

export const PROJECT_GET_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['projectId'],
  properties: {
    projectId: { type: 'string', minLength: 1 },
    history: { type: 'boolean' },
    cursor: { type: ['string', 'null'] },
    max_chars: { type: 'integer', minimum: 1000, maximum: 16000 },
  },
});

export function validateProjectArgs(args = {}) {
  const errors = [];
  const allowed = new Set(['projectId', 'history', 'cursor', 'max_chars']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) errors.push(`unknown_field:${key}`);
  if (typeof args.projectId !== 'string' || args.projectId.length === 0) errors.push('projectId_required');
  if (args.history !== undefined && typeof args.history !== 'boolean') errors.push('invalid_history');
  if (args.max_chars !== undefined) {
    const value = args.max_chars;
    if (!Number.isInteger(value) || value < 1000 || value > 16000) errors.push('max_chars_out_of_range');
  }
  return { ok: errors.length === 0, errors };
}

export function createProjectHandler({ main, clock }) {
  return {
    get(args = {}) {
      const validation = validateProjectArgs(args);
      if (!validation.ok) {
        return { status: 'error', code: 'validation_error', errors: validation.errors, clock: clock.at().at };
      }
      return projectGet({
        main,
        clock,
        projectId: args.projectId,
        history: args.history === true,
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
      });
    },
  };
}
