import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { createRoundInjector } from '../src/runtime/inject-round.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate, recordCandidates } from '../src/write/candidate.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function seed(ctx, index) {
  const runtime = fakeRuntime({ role: 'daily', identity: 'inj', callId: 'inj-' + index, messageSeq: 28000 + index });
  const observation = ingestInput(runtime, { text: '注入目录记忆-' + index, messageSeq: 28000 + index }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const created = recordCandidates(runtime, {
    items: [{
      observationId: observation.observation.id,
      text: '注入目录记忆-' + index,
      why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
      evidenceRefs: [{ observationId: observation.observation.id, sourceSpan: 'bytes:0:5' }],
    }],
  }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  promoteCandidate(runtime, created.items[0].id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });
}

test('P6/inject-round: turn/start refreshes an empty directory into compiled memory ids', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  seed(ctx, 1);
  const bus = new EventEmitter();
  const injector = createRoundInjector({
    ctx: bus,
    handles: ctx.handles,
    modules: { context: true },
    compileRound,
    tokenizer: conservativeTokens,
    H: 1000,
    clock: ctx.clock,
  });
  t.after(() => injector.dispose());
  assert.equal(injector.current().text, '');
  bus.emit('session/event', { type: 'turn/start', session: { header: { id: 'session-inj' } }, id: 'turn-1' });
  const current = injector.current();
  assert.ok(current.text.length > 0, JSON.stringify(current));
  assert.ok(current.manifest.eligible_ids.length > 0, JSON.stringify(current.manifest));
  assert.equal(current.delivery, 'unknown');
});

test('P6/inject-round: missing tokenizer/H falls back to tools-only and never pretends delivery', () => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  try {
    const injector = createRoundInjector({ ctx: { on() {} }, handles: ctx.handles, modules: {}, compileRound, tokenizer: null, H: null, clock: ctx.clock });
    injector.refresh({ session: { header: { id: 's' } }, id: 't' });
    assert.equal(injector.current().delivery_level, 'unavailable');
    assert.equal(injector.current().delivery, 'unknown');
    assert.match(injector.current().text, /tools-only/);
  } finally {
    ctx.cleanup();
  }
});

test('P6/inject-round: context=false yields empty text and does not subscribe', () => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  try {
    let subscribed = false;
    const bus = { on() { subscribed = true; } };
    const injector = createRoundInjector({ ctx: bus, handles: ctx.handles, modules: { context: false }, compileRound, tokenizer: conservativeTokens, H: 1000, clock: ctx.clock });
    injector.refresh({ id: 't' });
    assert.equal(injector.current().text, '');
    assert.equal(injector.current().delivery_level, 'disabled');
    assert.equal(subscribed, false);
  } finally {
    ctx.cleanup();
  }
});
