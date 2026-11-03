import { filterFeed, POLICY_REVISION } from '../feed/filter.mjs';

export const FEED_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['keywords'],
  properties: {
    keywords: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    recent_days: { type: 'integer', minimum: 1, maximum: 7 },
  },
});

export function validateFeedArgs(args = {}) {
  const errors = [];
  for (const key of Object.keys(args)) {
    if (key !== 'keywords' && key !== 'recent_days') errors.push(`unknown_field:${key}`);
  }
  if (!Array.isArray(args.keywords) || args.keywords.length === 0) errors.push('keywords_unavailable');
  if (args.recent_days !== undefined && (!Number.isInteger(args.recent_days) || args.recent_days < 1 || args.recent_days > 7)) {
    errors.push('feed_window_invalid');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * memsys_feed accepts candidates only from a controlled provider. It never
 * writes observations, memories or uses, and it never guesses a timestamp.
 */
export function createFeedHandler({ provider = null, clock }) {
  return {
    feed(args = {}) {
      const validation = validateFeedArgs(args);
      if (!validation.ok) {
        return { status: 'error', code: validation.errors[0], errors: validation.errors };
      }
      if (!provider || typeof provider.candidates !== 'function') {
        return { status: 'error', code: 'feed_provider_unavailable' };
      }
      const now = clock.now();
      let supplied;
      try {
        supplied = provider.candidates({ keywords: args.keywords, recentDays: args.recent_days ?? 7 });
      } catch (err) {
        return { status: 'error', code: 'feed_provider_error', message: err.message };
      }
      if (!supplied || supplied.status === 'error') {
        return { status: 'error', code: 'feed_provider_error', message: supplied?.message ?? null };
      }
      if (!Array.isArray(supplied.items)) {
        return { status: 'error', code: 'feed_provider_error', message: 'items_missing' };
      }
      const result = filterFeed({
        items: supplied.items,
        keywords: args.keywords,
        recentDays: args.recent_days ?? 7,
        now,
        policyRevision: supplied.policyRevision ?? POLICY_REVISION,
      });
      return { ...result, provider: supplied.provider ?? provider.provider ?? 'controlled' };
    },
  };
}
