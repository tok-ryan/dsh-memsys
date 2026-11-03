import { getMemories } from '../read/get.mjs';
import { searchMemories } from '../read/search.mjs';
import { reviewGet } from '../read/review.mjs';
import { recordLookup } from '../read/activity.mjs';
import { getGroupPage } from '../context/snapshots.mjs';
import { dreamGet, dreamReviewList } from '../read/dream.mjs';

/**
 * Unified read handlers for the batch-1 tools. The same handlers are used by the
 * offline tests and by any future host adapter; they never assume a host API.
 */
export function createReadHandler({ main, control, clock, dream = null }) {
  return {
    get(args = {}) {
      return getMemories({
        main,
        clock,
        ids: args.ids,
        view: args.view ?? 'current',
        includeEvidence: args.include_evidence === true,
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
      });
    },
    search(args = {}) {
      return searchMemories({
        main,
        clock,
        keywords: args.keywords ?? null,
        scene: args.scene ?? null,
        topicKey: args.topic_key ?? null,
        timeRange: args.time_range ?? null,
        graph: args.graph ?? null,
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
      });
    },
    review(args = {}) {
      if (args.kind === 'dream') {
        if (!dream) return { status: 'error', code: 'dream_unavailable', clock: clock.at().at };
        const listing = dreamReviewList({ dream, clock });
        const maxChars = Math.max(1000, Math.min(16000, args.max_chars ?? 8000));
        let used = 0;
        const items = [];
        for (const item of listing.items) {
          const size = JSON.stringify(item).length;
          if (items.length > 0 && used + size > maxChars) break;
          items.push(item);
          used += size;
        }
        return { status: 'ok', kind: 'dream', items, truncated: items.length < listing.items.length, clock: clock.at().at };
      }
      return reviewGet({
        main,
        clock,
        ids: args.ids ?? null,
        kind: args.kind ?? null,
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
      });
    },
    dreamPage(args = {}) {
      if (!dream) return { status: 'error', code: 'dream_unavailable', clock: clock.at().at };
      if (typeof args.dreamId !== 'string') return { status: 'error', code: 'validation_error', field: 'dreamId' };
      return dreamGet({ dream, clock, dreamId: args.dreamId });
    },
    context(args = {}) {
      if (typeof args.snapshot_revision !== 'string' || typeof args.group_id !== 'string') {
        return { status: 'error', code: 'validation_error', message: 'snapshot_revision_and_group_id_required', clock: clock.at().at };
      }
      return getGroupPage({
        control,
        main,
        clock,
        snapshotRevision: args.snapshot_revision,
        groupId: args.group_id,
        cursor: args.cursor ?? null,
        maxChars: args.max_chars ?? 8000,
        view: args.view ?? 'current',
      });
    },
    touch(args = {}) {
      return recordLookup({ main, clock, ...args });
    },
  };
}

/** Names the batch-1 adapter may bind once the host tool API is verified. */
export const BATCH1_TOOLS = Object.freeze([
  'memsys_get',
  'memsys_search',
  'memsys_review_get',
  'memsys_context_get',
  'memsys_record',
]);
