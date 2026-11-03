import assert from 'node:assert/strict';
import test from 'node:test';

import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate } from '../src/write/candidate.mjs';
import { approveDuePolicy, handleOwnerDueCommand, duePayloadHash } from '../src/write/due-actions.mjs';
import { recheckOperation } from '../src/control/recovery.mjs';
import { insertCandidate, insertMemory, insertObservation, insertPointer, insertTimeline } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function pendingMemory(ctx, text = '待确认') {
  const observation = makeObservation(ctx, { messageSeq: 20001, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'p6-l1-due', text, why: 'w', type: 'promise', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, { due_state: 'pending-due' });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  ctx.main
    .prepare("INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason) VALUES (?, 'pending-due', 1, ?, NULL, NULL, 0, 'promote')")
    .run(memory.id, ctx.clock.at().at);
  return memory;
}

function latestOperation(ctx, objectKey) {
  return ctx.control
    .prepare('SELECT * FROM operations WHERE object_key = ? ORDER BY created_at DESC, operation_id DESC LIMIT 1')
    .get(objectKey);
}

test('P6/L1 promote: missing relation set is unknown on recheck', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const ingested = ingestInput(fakeRuntime({ role: 'daily', callId: 'p6-promote', messageSeq: 20010 }), { text: '候选原话', messageSeq: 20010 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const promoted = promoteCandidate(fakeRuntime({ role: 'daily', callId: 'p6-promote-2' }), ingested.capture.id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(promoted.status, 'found');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_relations_no_delete');
  ctx.main.prepare("DELETE FROM relations WHERE type = 'promote'").run();
  const rechecked = recheckOperation({ main: ctx.main, control: ctx.control, operationId: promoted.operationId });
  assert.equal(rechecked.status, 'unknown', JSON.stringify(rechecked));
  assert.match(rechecked.reason ?? '', /expected_event_missing:promote/);
});

test('P6/L1 due: tampered due-state event is unknown, normal one is found', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const memory = pendingMemory(ctx);
  approveDuePolicy({ main: ctx.main, control: ctx.control, clock: ctx.clock }, { policyRevision: 'due-policy-v1' });
  const confirmed = handleOwnerDueCommand(
    { main: ctx.main, control: ctx.control, clock: ctx.clock, H: 200000, dueLimits: { members: 64, bytes: 12288, hRatio: 0.6 } },
    { text: `/mem due-confirm ${memory.id} 0 ${duePayloadHash(memory.id, 0)}`, inputEventId: 'p6-due', ownerId: 'owner' },
  );
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const operation = latestOperation(ctx, `main:due:${memory.id}`);
  assert.ok(operation);
  const normal = recheckOperation({ main: ctx.main, control: ctx.control, operationId: operation.operation_id });
  assert.equal(normal.status, 'found', JSON.stringify(normal));

  ctx.main.exec('DROP TRIGGER IF EXISTS trg_relations_no_update');
  ctx.main.prepare("UPDATE relations SET payload = '{}' WHERE type = 'due-state' AND json_extract(payload, '$.memoryId') = ?").run(memory.id);
  const tampered = recheckOperation({ main: ctx.main, control: ctx.control, operationId: operation.operation_id });
  assert.equal(tampered.status, 'unknown', JSON.stringify(tampered));
  assert.match(tampered.reason ?? '', /expected_due_event_mismatch/);
});
