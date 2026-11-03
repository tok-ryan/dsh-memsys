import assert from 'node:assert/strict';
import test from 'node:test';

import { insertCandidate, insertMemory, insertObservation, insertPointer, insertTimeline } from '../src/storage/repositories.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

test('P5/E: keywords array still matches business text', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const observation = makeObservation(ctx, { messageSeq: 17001, text: '葱是绿的' });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'p5e', text: '葱是绿的', why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });

  const result = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: ['葱'], maxChars: 8000 });
  assert.ok(result.direct_hit_count >= 1, JSON.stringify(result));
  assert.ok(result.hits.some((hit) => hit.text.includes('葱')));
  const serialized = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: '["葱"]', maxChars: 8000 });
  assert.ok(serialized.direct_hit_count >= 1, JSON.stringify(serialized));
});
