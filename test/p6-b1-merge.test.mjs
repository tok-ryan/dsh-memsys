import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
} from '../src/storage/repositories.mjs';
import { mergeExact } from '../src/dream/organize.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function memory(ctx, { type = 'fact', dueState = 'none', deadline = null } = {}) {
  seq += 1;
  const text = '完全相同的合并记忆';
  const observation = makeObservation(ctx, { messageSeq: 25000 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p6b1-${seq}`, text, why: 'w', type, scene: 'work', scope: 'work-only' });
  Object.assign(candidate, { key_status: 'resolved', binding_status: 'accepted', binding_basis: '{}', origin_mode: 'self', semantic_status: 'quoted', record_kind: 'utterance' });
  insertCandidate(ctx.main, candidate);
  const row = makeMemory(ctx, candidate);
  Object.assign(row, {
    key_status: 'resolved', binding_status: 'accepted', binding_basis: '{}', origin_mode: 'self',
    semantic_status: 'quoted', record_kind: 'utterance', due_state: dueState,
  });
  insertMemory(ctx.main, row);
  insertTimeline(ctx.main, { memory_id: row.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: row.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  if (deadline) {
    ctx.main
      .prepare("INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason) VALUES (?, 'none', 1, ?, NULL, ?, 0, 'test')")
      .run(row.id, ctx.clock.at().at, deadline);
  }
  return row;
}

function merge(ctx, a, b) {
  return mergeExact(
    { main: ctx.main, control: ctx.control, clock: ctx.clock },
    { runtime: fakeRuntime({ role: 'dream', callId: 'p6b1' }), ids: [a.id, b.id] },
  );
}

test('P6/B1: promise, done/dropped and non-empty due are blocked from merge', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  for (const options of [{ type: 'promise' }, { dueState: 'done' }, { dueState: 'dropped' }, { deadline: '2026-12-01T00:00:00Z' }]) {
    const a = memory(ctx, options);
    const b = memory(ctx, options);
    assert.throws(
      () => merge(ctx, a, b),
      (err) => err.code === 'blocked_by_due_state',
      JSON.stringify(options),
    );
  }
});
