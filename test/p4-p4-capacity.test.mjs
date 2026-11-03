import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
  putState,
} from '../src/storage/repositories.mjs';
import { approveDuePolicy, duePayloadHash, handleOwnerDueCommand, checkDueCapacity } from '../src/write/due-actions.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { getGroupPage } from '../src/context/snapshots.mjs';
import { projectOverview } from '../src/write/project.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

function compileBudget(args) {
  let result = compileRound(args);
  if (result.reason === 'budget_exceeded' && Number.isFinite(result.requiredH)) {
    result = compileRound({ ...args, H: result.requiredH });
  }
  return result;
}

let seq = 0;

function pendingMemory(ctx, { text = '待确认惦记', scene = 'work', scope = 'work-only' } = {}) {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 9700 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p4a-${seq}`, text, why: '期限', type: 'promise', scene, scope });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, { due_state: 'pending-due', scene, scope });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  ctx.main
    .prepare("INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason) VALUES (?, 'pending-due', 1, ?, NULL, NULL, 0, 'promote')")
    .run(memory.id, ctx.clock.at().at);
  return memory;
}

test('P4/P4-A E4: due admission requires all three capacity dimensions', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  const memory = pendingMemory(ctx);
  approveDuePolicy(deps, { policyRevision: 'due-policy-v1' });
  const revision = 0;
  const text = `/mem due-confirm ${memory.id} ${revision} ${duePayloadHash(memory.id, revision)}`;

  const unknown = handleOwnerDueCommand(deps, { text, inputEventId: 'e4-a', ownerId: 'owner' });
  assert.equal(unknown.code, 'capacity_unknown', 'no H means capacity cannot be verified');

  const blocked = checkDueCapacity(ctx.main, { H: 10, targetBytes: 5000 });
  assert.equal(blocked.ok, false);

  const ok = handleOwnerDueCommand({ ...deps, H: 200000, dueLimits: { members: 64, bytes: 12288, hRatio: 0.6 } }, {
    text,
    inputEventId: 'e4-b',
    ownerId: 'owner',
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('P4/P4-A E7: grouped keeps protected members and never exceeds H', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  for (let i = 0; i < 12; i += 1) pendingMemory(ctx, { text: `惦记-${i}` });
  const project = {
    projectId: 'proj_e7',
    name: '受保护项目',
    effectiveRevision: 1,
    headRevision: 1,
    snapshot: { current_task: '任务', progress: null, next_action: null, blockers: null },
  };
  const probe = compileRound({ ...deps, mode: 'work', roundId: 'e7-probe', tokenizer: conservativeTokens, H: 1, project });
  assert.equal(probe.delivery_level, 'protected_overflow');
  const fullProbe = compileRound({ ...deps, mode: 'work', roundId: 'e7-full', tokenizer: conservativeTokens, H: 200000, project });
  const grouped = compileBudget({
    ...deps,
    mode: 'work',
    roundId: 'e7-grouped',
    tokenizer: conservativeTokens,
    H: probe.hard.tokens + 1,
    project,
  });
  assert.equal(grouped.delivery_level, 'grouped');
  assert.ok(grouped.section.text.includes('受保护项目'), 'project Overview is never deferred');
  const total = grouped.hard.tokens + (grouped.soft?.tokens ?? 0);
  assert.ok(total <= grouped.H, `total ${total} must stay within H ${grouped.H}`);
});

test('P4/P4-A E9: manifest covers fixed/review and status page is retrievable', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  pendingMemory(ctx, { text: '工作惦记', scene: 'work' });
  pendingMemory(ctx, { text: '生活惦记', scene: 'life', scope: 'life-only' });
  const compiled = compileRound({ ...deps, mode: 'work', roundId: 'e9', tokenizer: conservativeTokens, H: 20000 });
  assert.ok(compiled.manifest.eligible_ids.includes('fixed:__fixed__'));
  assert.ok(compiled.manifest.eligible_ids.some((id) => id.startsWith('review:due:')));
  assert.match(compiled.section.text, /待确认惦记 1 条/, 'status counts are filtered by scene');
  const page = getGroupPage({
    control: ctx.control,
    clock: ctx.clock,
    snapshotRevision: compiled.snapshot_revision,
    groupId: '__status__',
    cursor: null,
    maxChars: 8000,
  });
  assert.equal(page.status, 'ok');
  assert.ok(page.items.length >= 1);
  assert.match(page.items[0].text, /pending-due=/);
});

test('P4/P4-A E8: capacity rows persist real counts and streaks', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  for (let i = 0; i < 6; i += 1) pendingMemory(ctx, { text: `容量-${i}` });
  const overflow = compileRound({ ...deps, mode: 'work', roundId: 'e8-1', tokenizer: conservativeTokens, H: 1 });
  assert.equal(overflow.delivery_level, 'protected_overflow');
  const row = ctx.control.prepare('SELECT * FROM capacity_rounds ORDER BY rowid DESC LIMIT 1').get();
  assert.ok(Number(row.hard_tokens) > 0 || Number(row.soft_tokens) > 0);
  assert.ok(Number(row.soft_over_streak) >= 1 || Number(row.hard_over_streak) >= 1);
});
