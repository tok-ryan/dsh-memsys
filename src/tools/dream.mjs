import { recordDream } from '../dream/store.mjs';
import { mergeExact, supersedeProposal } from '../dream/organize.mjs';
import { dreamGet, dreamReviewList } from '../read/dream.mjs';

export const DREAM_RECORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['linkedIds', 'basis', 'idea', 'propositions'],
  properties: {
    linkedIds: { type: 'array', minItems: 0, maxItems: 20, items: { type: 'string' } },
    basis: { type: 'string', minLength: 1 },
    idea: { type: 'string', minLength: 1 },
    propositions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string', minLength: 1 } },
      },
    },
  },
});

export function validateDreamArgs(args = {}) {
  const errors = [];
  const allowed = new Set(['linkedIds', 'basis', 'idea', 'propositions']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) errors.push(`unknown_field:${key}`);
  if (!Array.isArray(args.linkedIds) || args.linkedIds.length > 20) errors.push('invalid_linkedIds');
  if (typeof args.basis !== 'string' || args.basis.length === 0) errors.push('invalid_basis');
  if (typeof args.idea !== 'string' || args.idea.length === 0) errors.push('invalid_idea');
  if (!Array.isArray(args.propositions) || args.propositions.length < 1 || args.propositions.length > 20) {
    errors.push('invalid_propositions');
  }
  return { ok: errors.length === 0, errors };
}

/** memsys_dream_record / dream review handlers (offline). */
export function createDreamHandler({ main, dream, control, clock }) {
  return {
    record(runtime, args = {}) {
      const validation = validateDreamArgs(args);
      if (!validation.ok) {
        return { ok: false, code: 'validation_error', errors: validation.errors };
      }
      return recordDream({ main, dream, control, clock }, { runtime, item: args });
    },
    get(args = {}) {
      if (typeof args.dreamId !== 'string' || args.dreamId.length === 0) {
        return { status: 'error', code: 'validation_error', field: 'dreamId' };
      }
      return dreamGet({ dream, clock, dreamId: args.dreamId });
    },
    organize(runtime, args = {}) {
      const action = args.action;
      if (action === 'merge_exact') {
        return mergeExact({ main, dream, control, clock }, { runtime, ids: args.ids });
      }
      if (action === 'supersede_proposal') {
        return supersedeProposal({ main, dream, control, clock }, {
          runtime,
          oldMemoryId: args.oldMemoryId,
          newMemoryId: args.newMemoryId,
          reason: args.reason ?? null,
        });
      }
      return { ok: false, code: 'validation_error', field: 'action' };
    },
    review() {
      return dreamReviewList({ dream, clock });
    },
  };
}
