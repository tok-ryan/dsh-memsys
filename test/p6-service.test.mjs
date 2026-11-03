import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemSysService } from '../src/runtime/service.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate, recordCandidates } from '../src/write/candidate.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;
function seedMemory(ctx, text) {
  seq += 1;
  const runtime = fakeRuntime({ role: 'daily', identity: 'svc', callId: 'svc-' + seq, messageSeq: 32000 + seq });
  const observation = ingestInput(runtime, { text: 'svc-' + seq, messageSeq: 32000 + seq }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const created = recordCandidates(runtime, {
    items: [{ observationId: observation.observation.id, text, why: 'w', type: 'fact', scene: 'work', scope: 'work-only', evidenceRefs: [{ observationId: observation.observation.id, sourceSpan: 'bytes:0:3' }] }],
  }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  promoteCandidate(runtime, created.items[0].id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });
}

test('P6/service: same externalId does not add rows; product is a candidate', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const service = createMemSysService({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  const first = service.ingest({ source: 'rss', externalId: 'a-1', kind: 'fact', text: '外部文章正文' }, { sessionId: 's-svc', callId: 'c-svc' });
  const second = service.ingest({ source: 'rss', externalId: 'a-1', kind: 'fact', text: '外部文章正文' }, { sessionId: 's-svc', callId: 'c-svc' });
  assert.equal(first.status, 'accepted');
  assert.equal(second.status, 'duplicate');
  assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM candidates').get().n, 1);
  assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n, 0);
});

test('P6/service: owner identity is rejected', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const service = createMemSysService({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.throws(
    () => service.ingest({ source: 'rss', externalId: 'a-2', text: 'x' }, { role: 'owner' }),
    (err) => err.code === 'validation_error',
  );
});

test('P6/service: directory returns a string containing a real memory id', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  seedMemory(ctx, '服务目录记忆');
  const memory = ctx.main.prepare('SELECT id FROM memories LIMIT 1').get();
  const service = createMemSysService({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  const text = service.directory({ scene: 'work', budget: 2000 });
  assert.equal(typeof text, 'string');
  assert.ok(text.includes(memory.id), text.slice(0, 200));
});
