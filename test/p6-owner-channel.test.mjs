import assert from 'node:assert/strict';
import test from 'node:test';

import { rejectCandidateAsOwner, promoteCandidate, promoteCandidateAsOwner } from '../src/write/candidate.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate as modelPromote, recordCandidates } from '../src/write/candidate.mjs';
import { insertCandidate, insertEvidence, insertObservation } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;
function seedMemory(ctx, text) {
  seq += 1;
  const runtime = fakeRuntime({ role: 'daily', identity: 'owner-test', callId: 'o-' + seq, messageSeq: 35000 + seq });
  const observation = ingestInput(runtime, { text: 'seed-' + seq, messageSeq: 35000 + seq }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const created = recordCandidates(runtime, {
    items: [{ observationId: observation.observation.id, text, why: 'w', type: 'fact', scene: 'work', scope: 'work-only', evidenceRefs: [{ observationId: observation.observation.id, sourceSpan: 'bytes:0:3' }] }],
  }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  modelPromote(runtime, created.items[0].id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });
}

function pendingCandidate(ctx, text) {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 36000 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `owner-${seq}`, text, why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  insertEvidence(ctx.main, {
    id: `ev_owner_${seq}`,
    memory_id: null,
    candidate_id: candidate.id,
    observation_id: observation.id,
    source_memory_id: null,
    role: 'basis',
    source_span: `bytes:0:${Buffer.byteLength(text, 'utf8')}`,
    at: ctx.clock.at().at,
  });
  return { id: candidate.id };
}

const owner = { role: 'owner', identity: 'owner', sessionId: 'owner', callId: 'owner-call' };

test('P6/owner: owner promotes a candidate and the memory origin is owner, not model', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = pendingCandidate(ctx, '主人批准的记忆');
  const base = ctx.main.prepare('SELECT payload_hash FROM candidates WHERE id = ?').get(candidate.id).payload_hash;
  const result = promoteCandidateAsOwner(owner, candidate.id, base, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(result.status, 'found');
  const memory = ctx.main.prepare('SELECT * FROM memories WHERE text = ?').get('主人批准的记忆');
  assert.ok(memory, 'memory written');
  assert.match(memory.origin, /owner@/);
  assert.doesNotMatch(memory.origin, /model:/);
  const event = ctx.main.prepare("SELECT payload FROM relations WHERE type = 'promote' AND json_extract(payload, '$.candidateId') = ?").get(candidate.id);
  assert.equal(JSON.parse(event.payload).by, 'owner');
});

test('P6/owner: stale baseRevision returns 409 and writes no memory', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = pendingCandidate(ctx, '并发冲突记忆');
  assert.throws(
    () => promoteCandidateAsOwner(owner, candidate.id, 'wrong-revision', { main: ctx.main, control: ctx.control, clock: ctx.clock }),
    (err) => err.code === 'stale_candidate',
  );
  assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories WHERE text = ?').get('并发冲突记忆').n, 0);
});

test('P6/owner: owner rejects a candidate with a reason', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = pendingCandidate(ctx, '主人拒绝的记忆');
  const result = rejectCandidateAsOwner(owner, candidate.id, '主人说不需要', { main: ctx.main, control: ctx.control, clock: ctx.clock });
  assert.equal(result.status, 'found');
  const row = ctx.main.prepare('SELECT status, rejected_reason FROM candidates WHERE id = ?').get(candidate.id);
  assert.equal(row.status, 'rejected');
  assert.equal(row.rejected_reason, '主人说不需要');
});

test('P6/owner: a model-side caller cannot forge role owner', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = pendingCandidate(ctx, '伪造主人记忆');
  assert.throws(
    () => promoteCandidate({ role: 'owner', identity: 'forged', sessionId: 'forged' }, candidate.id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock }),
    (err) => err.code === 'invalid_role',
  );
});
