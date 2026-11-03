import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
} from '../src/storage/repositories.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { recordDelivery } from '../src/context/delivery.mjs';
import { getMemories } from '../src/read/get.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { gateRequireLive } from '../src/gates/checks.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

function compileBudget(args) {
  let result = compileRound(args);
  if (result.reason === 'budget_exceeded' && Number.isFinite(result.requiredH)) {
    result = compileRound({ ...args, H: result.requiredH });
  }
  return result;
}

let seq = 0;

function memory(ctx, { text = '分页记忆', scene = 'work', scope = 'work-only' } = {}) {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 9800 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p4b-${seq}`, text, why: 'w', type: 'fact', scene, scope });
  insertCandidate(ctx.main, candidate);
  const row = makeMemory(ctx, candidate);
  Object.assign(row, { scene, scope });
  insertMemory(ctx.main, row);
  insertTimeline(ctx.main, { memory_id: row.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: row.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  return row;
}

test('P4/P4-B E10: receipts must match the persistent manifest and groups', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  memory(ctx, { text: '回执记忆' });
  for (let i = 0; i < 8; i += 1) memory(ctx, { text: '回执成员' + i });
  const project = { projectId: 'proj_e10', name: '回执项目', effectiveRevision: 1, headRevision: 1, snapshot: { current_task: 't' } };
  const probe = compileRound({ ...deps, mode: 'work', roundId: 'e10-probe', tokenizer: conservativeTokens, H: 1, project });
  const fullProbe = compileRound({ ...deps, mode: 'work', roundId: 'e10-full', tokenizer: conservativeTokens, H: 200000, project });
  const compiled = compileBudget({ ...deps, mode: 'work', roundId: 'e10', tokenizer: conservativeTokens, H: probe.hard.tokens + 1, project });
  const expected = [...compiled.manifest.actual_ids, ...compiled.manifest.expected_ids.filter((id) => id.startsWith('group:'))];
  const groups = expected.filter((id) => id.startsWith('group:'));
  assert.ok(groups.length >= 1);
  const payloadHash = compiled.manifest.hashes.payload;

  const groupOnly = recordDelivery({
    ...deps,
    roundId: 'e10',
    snapshotId: compiled.snapshot_revision,
    expectedIds: expected,
    receivedIds: groups,
    payloadHash,
  });
  assert.notEqual(groupOnly.delivery, 'confirmed');
  assert.equal(groupOnly.code, 'receipt_incomplete');

  const deferredMembers = compiled.manifest.deferred_groups.flatMap((group) => group.members);
  assert.ok(deferredMembers.length >= 1, 'grouped has deferred members');
  const full = recordDelivery({
    ...deps,
    roundId: 'e10',
    snapshotId: compiled.snapshot_revision,
    expectedIds: expected,
    receivedIds: expected,
    payloadHash,
  });
  assert.equal(full.delivery, 'confirmed', JSON.stringify(full));
  const exposure = ctx.main.prepare('SELECT memory_id FROM injections').all().map((row) => row.memory_id);
  assert.equal(exposure.length, 0, 'deferred members must not produce exposure');
});

test('P4/P4-B E11: get/search cursors reject changed versions', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const long = memory(ctx, { text: '长'.repeat(3000) });
  const page = getMemories({ main: ctx.main, clock: ctx.clock, ids: [long.id], maxChars: 1000 });
  assert.equal(page.status, 'ok');
  assert.ok(page.next_cursor);
  ctx.main.prepare('UPDATE pointers SET revision = revision + 1 WHERE memory_id = ?').run(long.id);
  const next = getMemories({ main: ctx.main, clock: ctx.clock, ids: [long.id], maxChars: 1000, cursor: page.next_cursor });
  assert.equal(next.code, 'stale_cursor');

  const search = memory(ctx, { text: '搜索目标甲' + '长'.repeat(1200) });
  memory(ctx, { text: '搜索目标乙' });
  const first = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: '搜索目标', maxChars: 1000 });
  assert.ok(first.next_cursor, JSON.stringify(first));
  memory(ctx, { text: '搜索目标乙新出现' });
  const second = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: '搜索目标', maxChars: 1000, cursor: first.next_cursor });
  assert.equal(second.code, 'stale_cursor');
});

test('P4/P4-B E15: require-live accepts only status=passed with required fields', () => {
  for (const report of [{}, { status: 'unknown' }, { result: 'fail' }]) {
    const gate = gateRequireLive({ requireLive: true, liveReport: report });
    assert.equal(gate.ok, false, JSON.stringify(report));
  }
  const passed = gateRequireLive({
    requireLive: true,
    liveReport: { status: 'passed', case: 'tools', registration: { status: 'registered' }, tools: { result: 'ok', schemas_has_memsys: true, get_found: true } },
  });
  assert.equal(passed.ok, true);
  const missingFields = gateRequireLive({ requireLive: true, liveReport: { status: 'passed' } });
  assert.equal(missingFields.ok, false);
});
