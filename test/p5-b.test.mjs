import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
  appendRelation,
} from '../src/storage/repositories.mjs';
import { mergeExact } from '../src/dream/organize.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function activeMemory(ctx, overrides = {}) {
  seq += 1;
  const text = '完全相同的合并记忆';
  const observation = makeObservation(ctx, { messageSeq: 14000 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p5b-${seq}`, text, why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
  Object.assign(candidate, {
    key_status: 'resolved', binding_status: 'accepted', binding_basis: '{}', origin_mode: 'self',
    semantic_status: 'quoted', record_kind: 'utterance',
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, {
    key_status: 'resolved', binding_status: 'accepted', binding_basis: '{}', origin_mode: 'self',
    semantic_status: 'quoted', record_kind: 'utterance', due_state: overrides.dueState ?? 'none',
  });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, {
    memory_id: memory.id,
    start_at: overrides.startAt ?? '2026-01-01T00:00:00Z',
    end_at: overrides.endAt ?? '2026-01-02T00:00:00Z',
    prec_start: 'day', prec_end: 'day', time_state: 'exact', revision: 1,
  });
  insertPointer(ctx.main, {
    memory_id: memory.id, status: 'exact', location: 'C:/legacy/merge.md#L1',
    search_hint: 'search:merge', lossy: 0, revision: 1,
  });
  return memory;
}

test('P5/B1: merge preserves joined timeline/pointer and writes oldId/newId', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const a = activeMemory(ctx);
  const b = activeMemory(ctx);
  const result = mergeExact(
    { main: ctx.main, control: ctx.control, clock: ctx.clock },
    { runtime: fakeRuntime({ role: 'dream', callId: 'p5b-merge' }), ids: [a.id, b.id] },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const merged = ctx.main.prepare('SELECT * FROM memories WHERE id = ?').get(result.memoryId);
  const timeline = ctx.main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(result.memoryId);
  const pointer = ctx.main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(result.memoryId);
  assert.equal(timeline.start_at, '2026-01-01T00:00:00Z');
  assert.equal(timeline.time_state, 'exact');
  assert.equal(pointer.status, 'exact');
  assert.equal(pointer.location, 'C:/legacy/merge.md#L1');
  const supersede = ctx.main.prepare("SELECT payload FROM relations WHERE type = 'supersede' ORDER BY commit_seq LIMIT 1").get();
  const payload = JSON.parse(supersede.payload);
  assert.equal(payload.oldId, a.id);
  assert.equal(payload.newId, result.memoryId);
  assert.equal(Object.hasOwn(payload, 'oldMemoryId'), false);
  assert.ok(merged);
});

test('P5/B1: inactive facts cannot be merged', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const a = activeMemory(ctx);
  const b = activeMemory(ctx);
  appendRelation(ctx.main, {
    type: 'supersede',
    payload: { oldId: b.id, newId: a.id, reason: 'test' },
    businessKey: 'retire-b',
    at: ctx.clock.at().at,
    keyEncoding: 'canonical',
    eventVersion: '2',
    payloadVersion: '2',
  });
  assert.throws(
    () => mergeExact(
      { main: ctx.main, control: ctx.control, clock: ctx.clock },
      { runtime: fakeRuntime({ role: 'dream', callId: 'p5b-inactive' }), ids: [a.id, b.id] },
    ),
    (err) => err.code === 'validation_error' || err.code === 'inactive_fact',
  );
});
