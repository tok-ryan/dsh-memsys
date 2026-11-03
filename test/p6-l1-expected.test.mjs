import assert from 'node:assert/strict';
import test from 'node:test';

import { observeInput, ingestInput } from '../src/write/observe.mjs';
import { recheckOperation } from '../src/control/recovery.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

test('P6/L1 observation: tampered payload is unknown on recheck', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime({ role: 'daily', callId: 'p6-l1-obs', messageSeq: 19001 });
  const observed = observeInput(runtime, { text: '原始文字', messageSeq: 19001 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(observed.receipt.status, 'found');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_observations_no_update');
  ctx.main.prepare('UPDATE observations SET text = ? WHERE id = ?').run('被篡改', observed.observation.id);
  const rechecked = recheckOperation({ main: ctx.main, control: ctx.control, operationId: observed.receipt.operationId });
  assert.equal(rechecked.status, 'unknown', JSON.stringify(rechecked));
  assert.match(rechecked.reason ?? '', /expected_/);
});

test('P6/L1 candidate: missing expected event is unknown on recheck', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime({ role: 'daily', callId: 'p6-l1-cand', messageSeq: 19002 });
  const ingested = ingestInput(runtime, { text: '记住：葱可以吃', messageSeq: 19002 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(ingested.captureReceipt.status, 'found');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_relations_no_delete');
  ctx.main.prepare("DELETE FROM relations WHERE type = 'shelve'").run();
  const rechecked = recheckOperation({ main: ctx.main, control: ctx.control, operationId: ingested.captureReceipt.operationId });
  assert.equal(rechecked.status, 'unknown', JSON.stringify(rechecked));
  assert.match(rechecked.reason ?? '', /expected_event_missing/);
});
