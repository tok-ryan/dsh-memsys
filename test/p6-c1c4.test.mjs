import assert from 'node:assert/strict';
import test from 'node:test';

import { recordDelivery } from '../src/context/delivery.mjs';
import { getMemories } from '../src/read/get.mjs';
import {
  insertCandidate, insertEvidence, insertMemory, insertObservation, insertPointer, insertTimeline,
} from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

function deliveryFixture(ctx, { actualIds, expectedIds, receivedIds, hash = 'h' }) {
  const roundId = 'r-c1';
  const snapshotId = 'snap-c1';
  ctx.control
    .prepare("INSERT OR REPLACE INTO compilations (id, round_id, stream_key, source_revision, policy_revision, delivery_level, payload_hash, section_text, created_at) VALUES (?, ?, 'stream', 0, '1', 'grouped', ?, '', ?)")
    .run(`comp:${snapshotId}`, roundId, hash, ctx.clock.at().at);
  ctx.control
    .prepare("INSERT OR REPLACE INTO context_snapshots (id, compilation_id, round_id, mode, source_revision, policy_revision, delivery_level, eligible_ids, expected_ids, deferred_groups, created_at, expires_at, manifest_json) VALUES (?, ?, ?, 'work', 0, '1', 'grouped', '[]', ?, '[]', ?, ?, ?)")
    .run(snapshotId, `comp:${snapshotId}`, roundId, JSON.stringify(expectedIds), ctx.clock.at().at, ctx.clock.at().at, JSON.stringify({ expected_ids: expectedIds, actual_ids: actualIds, hashes: { payload: hash } }));
  return recordDelivery({ main: ctx.main, control: ctx.control, clock: ctx.clock, roundId, snapshotId, receivedIds, payloadHash: hash, manifestHash: 'm', slots: {} });
}

test('P6/C1: group-only receipt with empty actual set is incomplete', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const result = deliveryFixture(ctx, { actualIds: [], expectedIds: ['group:g1'], receivedIds: ['group:g1'] });
  assert.equal(result.delivery, 'incomplete');
  assert.equal(result.code, 'receipt_incomplete');
  assert.notEqual(result.delivery, 'confirmed');
});

test('P6/C1: non-empty actual set missing one memory is incomplete', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const result = deliveryFixture(ctx, { actualIds: ['mem_a', 'mem_b'], expectedIds: ['mem_a', 'mem_b', 'group:g1'], receivedIds: ['mem_a', 'group:g1'] });
  assert.equal(result.delivery, 'incomplete');
  assert.equal(result.code, 'receipt_incomplete');
  assert.deepEqual(result.missing_ids, ['mem_b']);
});

test('P6/C4: evidence text pages reassemble byte-for-byte', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const original = '证据原文'.repeat(600);
  const observation = makeObservation(ctx, { messageSeq: 30000, text: original });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'c4', text: '短摘要', why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  insertEvidence(ctx.main, { id: 'ev_c4', memory_id: memory.id, candidate_id: null, observation_id: observation.id, source_memory_id: null, role: 'basis', source_span: 'bytes:0:4', at: ctx.clock.at().at });

  let cursor = null;
  let joined = '';
  for (let page = 0; page < 20; page += 1) {
    const result = getMemories({ main: ctx.main, clock: ctx.clock, ids: [memory.id], includeEvidence: true, maxChars: 1000, cursor });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    for (const item of result.items) {
      for (const evidence of item.evidence ?? []) {
        if (typeof evidence.observation_text === 'string') joined += evidence.observation_text;
      }
    }
    cursor = result.next_cursor;
    if (!cursor) break;
  }
  assert.equal(joined, original);
});
