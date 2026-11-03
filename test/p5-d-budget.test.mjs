import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { insertCandidate, insertMemory, insertObservation, insertPointer, insertTimeline } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

test('P5/D C2: no delivery over H; open members stay in the grouped text', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  for (let i = 0; i < 6; i += 1) {
    const observation = makeObservation(ctx, { messageSeq: 16000 + i, text: `保护-open-${i}` });
    insertObservation(ctx.main, observation);
    const candidate = makeCandidate(ctx, observation, { businessKey: `p5d-${i}`, text: `保护-open-${i}`, why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
    insertCandidate(ctx.main, candidate);
    const memory = makeMemory(ctx, candidate);
    Object.assign(memory, { due_state: 'open' });
    insertMemory(ctx.main, memory);
    insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
    insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  }
  const tiny = compileRound({ ...deps, mode: 'work', roundId: 'p5d-tiny', tokenizer: conservativeTokens, H: 1 });
  assert.notEqual(tiny.delivery_level, 'full');
  assert.ok(tiny.requiredH === undefined || tiny.requiredH > 1, JSON.stringify(tiny));
  const H = tiny.requiredH ?? 20000;
  const ok = compileRound({ ...deps, mode: 'work', roundId: 'p5d-ok', tokenizer: conservativeTokens, H });
  if (ok.delivery_level === 'budget_exceeded') {
    assert.ok(false, 'requiredH must be sufficient');
  }
  assert.ok(ok.total.tokens <= ok.H, `final text ${ok.total.tokens} must fit H ${ok.H}`);
  assert.ok(ok.section.text.includes('保护-open-0'), 'open protected member is in the final text');
});
