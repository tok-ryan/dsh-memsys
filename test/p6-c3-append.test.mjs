import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { getGroupPage } from '../src/context/snapshots.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate, recordCandidates } from '../src/write/candidate.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;
function addMemory(ctx, text) {
  seq += 1;
  const runtime = fakeRuntime({ role: 'daily', identity: 'c3a', callId: 'c3a-' + seq, messageSeq: 31000 + seq });
  const observation = ingestInput(runtime, { text: 'C3-' + seq, messageSeq: 31000 + seq }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const created = recordCandidates(runtime, {
    items: [{
      observationId: observation.observation.id,
      text,
      why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
      evidenceRefs: [{ observationId: observation.observation.id, sourceSpan: 'bytes:0:3' }],
    }],
  }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  promoteCandidate(runtime, created.items[0].id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });
}

function make(ctx) {
  for (let i = 0; i < 12; i += 1) addMemory(ctx, 'C3混版-' + i + '-' + 'x'.repeat(500));
}

function compile(ctx, roundId) {
  return compileRound({ main: ctx.main, control: ctx.control, clock: ctx.clock, sessionId: 's-c3a', roundId, mode: 'work', tokenizer: conservativeTokens, H: 300 });
}

function page(ctx, snapshotRevision, groupId, cursor = null) {
  return getGroupPage({ control: ctx.control, main: ctx.main, clock: ctx.clock, snapshotRevision, groupId, cursor, maxChars: 1000 });
}

test('P6/C3: old cursor is stale after an append through the promote path', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  make(ctx);
  const first = compile(ctx, 'r-c3a');
  assert.equal(first.delivery_level, 'grouped', JSON.stringify(first.delivery_level));
  const groupId = first.groups[0].group_id;
  const firstPage = page(ctx, first.snapshot_revision, groupId);
  assert.equal(firstPage.status, 'ok', JSON.stringify(firstPage));
  assert.ok(firstPage.next_cursor);
  addMemory(ctx, '追加混版-' + 'y'.repeat(500));
  const stale = page(ctx, first.snapshot_revision, groupId, firstPage.next_cursor);
  assert.equal(stale.status, 'error', JSON.stringify(stale));
  assert.equal(stale.code, 'stale_cursor');
});

test('P6/C3: same data recompiles to same id; append changes it', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  make(ctx);
  const a = compile(ctx, 'r-c3b1');
  const b = compile(ctx, 'r-c3b2');
  assert.equal(a.snapshot_revision, b.snapshot_revision);
  addMemory(ctx, '追加换ID-' + 'z'.repeat(500));
  const c = compile(ctx, 'r-c3b3');
  assert.notEqual(c.snapshot_revision, a.snapshot_revision);
});

test('P6/C3: clean paging reaches the end without stale_cursor', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  make(ctx);
  const compiled = compile(ctx, 'r-c3c');
  const groupId = compiled.groups[0].group_id;
  let cursor = null;
  let pages = 0;
  for (;;) {
    const result = page(ctx, compiled.snapshot_revision, groupId, cursor);
    assert.equal(result.status, 'ok', JSON.stringify(result));
    pages += 1;
    cursor = result.next_cursor;
    if (!cursor) break;
    assert.ok(pages < 100);
  }
  assert.ok(pages >= 1);
});
