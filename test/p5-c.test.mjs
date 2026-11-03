import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshot } from '../src/context/snapshots.mjs';
import { getMemories } from '../src/read/get.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { gateRequireLive } from '../src/gates/checks.mjs';
import { toolCapabilityStatus } from '../src/runtime/tools.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { insertObservation, insertCandidate, insertMemory, insertTimeline, insertPointer, appendRelation } from '../src/storage/repositories.mjs';

test('P5/C3: same snapshot id with different content is rejected before writing', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const base = {
    control: ctx.control, clock: ctx.clock, snapshotId: 'snap:p5c', roundId: 'r-p5c',
    mode: 'work', level: 'full', sourceRevision: 1, policyRevision: 'p', eligibleIds: [],
    expectedIds: [], groups: [], H: 100,
    metrics: { hard: { count: 0, bytes: 0, tokens: 0 }, soft: { count: 0, codePoints: 0, bytes: 0, tokens: 0 }, total: { count: 0, bytes: 0, tokens: 0 }, fullDirectoryBytes: 0, groupCount: 0, deferredCount: 0 },
  };
  createSnapshot({ ...base, sectionText: 'A', sectionHash: 'h-A' });
  assert.throws(
    () => createSnapshot({ ...base, sectionText: 'B', sectionHash: 'h-B' }),
    (err) => err.code === 'snapshot_id_conflict',
  );
  const row = ctx.control.prepare('SELECT section_text FROM compilations WHERE id = ?').get('comp:snap:p5c');
  assert.equal(row.section_text, 'A', 'the old snapshot is not overwritten');
});

test('P5/C4: uses counts times, conflict reads refs, observation obeys max_chars', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const observation = makeObservation(ctx, { messageSeq: 15001, text: '葱'.repeat(1500) });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'p5c', text: '葱'.repeat(1500), why: 'w', type: 'fact', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  ctx.main.prepare('INSERT INTO uses (memory_id, count, last_used_at) VALUES (?, ?, ?)').run(memory.id, 3, ctx.clock.at().at);
  const found = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: '葱', maxChars: 8000 });
  assert.equal(found.direct_hit_count, 1);
  assert.equal(found.evidence_mean, 0.4 * 0.35 + 0.2 * Math.min(3 / 5, 1));

  appendRelation(ctx.main, {
    type: 'conflict', payload: { refs: [memory.id], reason: 'test' }, businessKey: 'p5c-conflict',
    at: ctx.clock.at().at, keyEncoding: 'canonical', eventVersion: '2', payloadVersion: '2',
  });
  const got = getMemories({ main: ctx.main, clock: ctx.clock, ids: [memory.id] });
  assert.equal(got.items[0].group.conflict_marker, true);

  const page = getMemories({ main: ctx.main, clock: ctx.clock, ids: [observation.id], maxChars: 1000 });
  assert.equal(page.status, 'ok');
  assert.ok(page.next_cursor, 'oversized observation paginates');
  assert.ok(page.items[0].text.length < 1500);
  const next = getMemories({ main: ctx.main, clock: ctx.clock, ids: [observation.id], maxChars: 1000, cursor: page.next_cursor });
  assert.equal(next.status, 'ok');
});

test('P5/C5: inject gate is as strict as require-live and tools capability is registration-only', () => {
  assert.equal(gateRequireLive({ requireLive: true, liveReport: { status: 'passed', case: 'inject', section: { name: 'wrong' } } }).ok, false);
  assert.equal(gateRequireLive({ requireLive: true, liveReport: { status: 'passed', case: 'inject', section: { name: 'memsys:context', order: 500, result: 'ok' } } }).ok, true);
  const partial = toolCapabilityStatus({ status: 'passed', tools: { result: 'ok' } });
  assert.notEqual(partial.status, 'passed');
  const registered = toolCapabilityStatus({ status: 'passed', tools: { result: 'ok', schemas_has_memsys: true, get_found: true } });
  assert.equal(registered.status, 'passed');
  assert.equal(registered.capability, 'registration');
  assert.equal(registered.execution, 'unverified');
});
