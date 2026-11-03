import assert from 'node:assert/strict';
import test from 'node:test';

import { moduleEnabled, resolveModules } from '../src/runtime/modules.mjs';
import { toolDefinitions } from '../src/runtime/tools.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import {
  insertCandidate, insertMemory, insertObservation, insertPointer, insertTimeline,
} from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

let seq = 0;
function pendingMemory(ctx) {
  seq += 1;
  const text = '待确认惦记';
  const observation = makeObservation(ctx, { messageSeq: 27000 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `mod-${seq}`, text, why: '期限', type: 'promise', scene: 'work', scope: 'work-only' });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, { due_state: 'pending-due', scene: 'work', scope: 'work-only' });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  ctx.main
    .prepare("INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason) VALUES (?, 'pending-due', 1, ?, NULL, NULL, 0, 'promote')")
    .run(memory.id, ctx.clock.at().at);
  return memory;
}

test('P6/modules: defaults enable everything and register all 10 tools', () => {
  const modules = resolveModules({});
  assert.deepEqual(modules, {
    context: true, read: true, write: true, dream: true, projects: true, due: true, feed: true,
  });
  assert.equal(toolDefinitions({}, modules).length, 10);
});

test('P6/modules: read=false removes read tools but keeps write/dream/feed', () => {
  const modules = resolveModules({ modules: { read: false } });
  const names = toolDefinitions({}, modules).map((tool) => tool.name);
  for (const name of ['memsys_get', 'memsys_search', 'memsys_review_get', 'memsys_context_get', 'memsys_project_get', 'memsys_self_get']) {
    assert.ok(!names.includes(name), name);
  }
  assert.ok(names.includes('memsys_record'));
  assert.ok(names.includes('memsys_dream_record'));
  assert.ok(names.includes('memsys_feed'));
});

test('P6/modules: context=false disables the injection section', () => {
  const modules = resolveModules({ modules: { context: false } });
  assert.equal(moduleEnabled(modules, 'context'), false);
  assert.equal(moduleEnabled(modules, 'read'), true);
});

test('P6/modules: due=false removes review:* typed items from compile output', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const memory = pendingMemory(ctx);
  const base = { main: ctx.main, control: ctx.control, clock: ctx.clock, sessionId: 's-mod', roundId: 'r-mod', mode: 'work', tokenizer: conservativeTokens, H: 200000 };
  const enabled = compileRound(base);
  assert.ok(enabled.eligible_ids.includes('review:due:' + memory.id), JSON.stringify(enabled.eligible_ids));
  const disabled = compileRound({ ...base, roundId: 'r-mod2', modules: { due: false } });
  assert.ok(!disabled.eligible_ids.some((id) => id.startsWith('review:')), JSON.stringify(disabled.eligible_ids));
});

test('P6/modules: legacy auto_inject maps to context without disabling other modules', () => {
  const modules = resolveModules({ auto_inject: true });
  assert.equal(modules.context, true);
  assert.equal(modules.read, true);
  assert.equal(modules.write, true);
  assert.equal(modules.dream, true);
  assert.equal(modules.projects, true);
  assert.equal(modules.due, true);
  assert.equal(modules.feed, true);
});
