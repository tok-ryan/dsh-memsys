import assert from 'node:assert/strict';
import test from 'node:test';

import { observeInput } from '../src/write/observe.mjs';
import { recoverCaptureJobs } from '../src/control/recovery.mjs';
import { reserveAttempt, completeAttempt } from '../src/control/ledger.mjs';
import { openAll, closeAll } from '../src/storage/open.mjs';
import { resolveConfig } from '../src/config.mjs';
import { createTestContext, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';
import { getCandidateByKey } from '../src/storage/repositories.mjs';
import { keys } from '../src/identity.mjs';

test('P5/A1: capture job freezes identity and scene; recovery keeps life', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime({ role: 'daily', callId: 'p5a-observe', messageSeq: 12001, mode: 'life', identity: 'master' });
  const observed = observeInput(runtime, { text: '生活里的原话', messageSeq: 12001 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(observed.receipt.status, 'found');
  const job = ctx.main
    .prepare("SELECT payload FROM relations WHERE type = 'capture-job' AND json_extract(payload, '$.observationId') = ?")
    .get(observed.observation.id);
  const payload = JSON.parse(job.payload);
  assert.equal(payload.mode, 'life');
  assert.equal(payload.identity, 'master');

  const recovered = recoverCaptureJobs({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.ok(recovered.length >= 1, JSON.stringify(recovered));
  const observation = ctx.main.prepare('SELECT * FROM observations WHERE id = ?').get(observed.observation.id);
  const sourceUnit = `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}`;
  const candidate = getCandidateByKey(ctx.main, keys.capture(observation.id, sourceUnit));
  assert.ok(candidate, 'capture candidate rebuilt');
  assert.equal(candidate.scene, 'life');
  assert.equal(candidate.scope, 'life-only');
});

test('P5/A4: third complete failure freezes and the freeze survives reopen', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  const clock = ctx.clock;
  let handles = ctx.handles;
  t.after(() => {
    try { closeAll(handles); } catch {}
  });
  const spec = {
    objectKey: 'main:freeze-p5',
    targetDb: 'main',
    requestKey: 'freeze-r0',
    payloadHash: 'h0',
    immutablePayload: '{}',
    targetIds: [],
  };
  for (let index = 0; index < 3; index += 1) {
    const reservation = reserveAttempt(handles.control, clock, { ...spec, requestKey: `freeze-r${index}` });
    completeAttempt(handles.control, clock, {
      objectKey: spec.objectKey,
      generation: reservation.generation,
      attemptNo: reservation.attemptNo,
      operationId: reservation.operationId,
      result: 'missing',
      readback: 'missing',
    });
  }
  const frozen = handles.control.prepare('SELECT frozen FROM object_streams WHERE object_key = ?').get(spec.objectKey);
  assert.equal(Number(frozen.frozen), 1, 'third failure must persist frozen');
  closeAll(handles);
  handles = openAll(ctx.config);
  const again = handles.control.prepare('SELECT frozen FROM object_streams WHERE object_key = ?').get(spec.objectKey);
  assert.equal(Number(again.frozen), 1, 'freeze survives restart');
  const live = handles.control.prepare('SELECT 1 AS ok FROM object_streams WHERE object_key = ?').get(spec.objectKey);
  assert.ok(live);
});
