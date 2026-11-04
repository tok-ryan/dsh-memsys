import assert from 'node:assert/strict';
import test from 'node:test';

import { withImmediate } from '../src/storage/open.mjs';
import {
  appendRelation,
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
} from '../src/storage/repositories.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { createReadHandler } from '../src/tools/read.mjs';
import { MEMSYS_TOOLS, registerHostTools, toolCapabilityStatus } from '../src/runtime/tools.mjs';
import { validateToolArgs } from '../src/tools/schemas.mjs';
import { listUses } from '../src/read/activity.mjs';
import { makeCandidate, makeMemory, makeObservation, createTestContext, mutableClock } from './helpers/fixtures.mjs';

let seq = 0;

function seed(ctx, overrides = {}) {
  seq += 1;
  const observation = makeObservation(ctx, {
    messageSeq: 200 + seq,
    text: overrides.text ?? `工具记忆${seq}`,
  });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, {
    businessKey: `m5:${seq}`,
    text: overrides.text ?? `工具记忆${seq}`,
    why: overrides.why ?? '测试',
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, {
    scene: overrides.scene ?? 'work',
    scope: overrides.scope ?? 'work-only',
    topic_key: overrides.topicKey ?? `unresolved:m5-${seq}`,
    semantic_status: overrides.semanticStatus ?? 'proposed',
    credibility: overrides.credibility ?? 'unverified',
    tags: JSON.stringify(overrides.tags ?? []),
    due_state: overrides.dueState ?? 'none',
  });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, {
    memory_id: memory.id,
    start_at: overrides.startAt ?? null,
    end_at: overrides.endAt ?? null,
    prec_start: 'unknown',
    prec_end: 'unknown',
    time_state: overrides.timeState ?? 'point',
    revision: 1,
  });
  insertPointer(ctx.main, {
    memory_id: memory.id,
    status: 'unknown',
    location: null,
    search_hint: null,
    lossy: 0,
    revision: 1,
  });
  return memory;
}

function contextWithTools(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const handler = createReadHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  return { ctx, handler };
}

test('M5 memsys_get contract', async (t) => {
  await t.test('ids are validated and missing ids are separated from readable ones', () => {
    const { ctx, handler } = contextWithTools(t);
    const memory = seed(ctx, { text: '可读取的记忆' });
    const tooMany = handler.get({ ids: Array.from({ length: 11 }, (_, i) => `id-${i}`) });
    assert.equal(tooMany.code, 'validation_error');
    const duplicate = handler.get({ ids: [memory.id, memory.id] });
    assert.equal(duplicate.code, 'validation_error');
    const result = handler.get({ ids: [memory.id, 'mem_missing'] });
    assert.equal(result.status, 'ok');
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.missing_ids, ['mem_missing']);
    assert.equal(result.items[0].text, '可读取的记忆');
    assert.equal(result.items[0].group.key_status, 'unresolved');
    assert.equal(typeof result.snapshot_revision, 'string');
    assert.match(result.snapshot_revision, /^rev_\d+$/);
    assert.ok(result.clock);
  });

  await t.test('include_evidence and history are exposed without altering stored text', () => {
    const { ctx, handler } = contextWithTools(t);
    const memory = seed(ctx, { text: '带证据的记忆' });
    withImmediate(ctx.main, () => {
      appendRelation(ctx.main, {
        type: 'supersede',
        payload: { oldId: memory.id, newId: 'mem_newer' },
        businessKey: `supersede:${memory.id}`,
        at: ctx.clock.at().at,
      });
    });
    const result = handler.get({ ids: [memory.id], include_evidence: true, view: 'history' });
    assert.equal(result.items[0].evidence.length, 0);
    assert.equal(result.items[0].history.length, 1);
    assert.equal(result.items[0].history[0].type, 'supersede');
    assert.equal(result.items[0].text, '带证据的记忆');
  });

  await t.test('oversized text pages by codepoints and rejoins exactly', () => {
    const { ctx, handler } = contextWithTools(t);
    const longText = '记忆'.repeat(1500);
    const memory = seed(ctx, { text: longText });
    let cursor = null;
    const fragments = [];
    let guard = 0;
    do {
      const page = handler.get({ ids: [memory.id], cursor, max_chars: 1000 });
      assert.equal(page.status, 'ok');
      const item = page.items[0];
      fragments.push(item.text);
      cursor = page.next_cursor;
      guard += 1;
      assert.ok(guard < 20, 'pagination must terminate');
    } while (cursor);
    assert.equal(fragments.join(''), longText);
    const bad = handler.get({ ids: [memory.id], cursor: 'not-a-cursor', max_chars: 1000 });
    assert.equal(bad.code, 'invalid_cursor');
  });
});

test('M5 memsys_search contract', async (t) => {
  await t.test('keyword, scene, topic and time filters work; empty result is ok, not an error', () => {
    const { ctx, handler } = contextWithTools(t);
    const hit = seed(ctx, { text: '不吃葱是习惯', topicKey: 'tk:food:scallion' });
    const lifeOnly = seed(ctx, { text: '不吃葱也一样', scene: 'life', scope: 'life-only' });
    const timed = seed(ctx, {
      text: '不吃葱的旧事',
      startAt: '2025-01-01T00:00:00.000Z',
      endAt: '2025-01-02T00:00:00.000Z',
      timeState: 'exact',
    });
    const keyword = handler.search({ keywords: '不吃葱' });
    assert.equal(keyword.status, 'ok');
    assert.ok(keyword.hits.some((entry) => entry.id === hit.id));
    assert.equal(keyword.direct_hit_count, 3);
    assert.ok(keyword.group_index);

    const scene = handler.search({ keywords: '不吃葱', scene: 'life' });
    assert.deepEqual(scene.hits.map((entry) => entry.id), [lifeOnly.id]);

    const topic = handler.search({ topic_key: 'tk:food:scallion' });
    assert.deepEqual(topic.hits.map((entry) => entry.id), [hit.id]);

    const range = handler.search({ time_range: { start: '2024-12-01', end: '2025-02-01' } });
    assert.deepEqual(range.hits.map((entry) => entry.id), [timed.id]);

    const empty = handler.search({ keywords: '完全没有的词' });
    assert.equal(empty.status, 'ok');
    assert.equal(empty.hits.length, 0);

    const graph = handler.search({ graph: { seed_ids: [hit.id], depth: 1 } });
    assert.equal(graph.code, 'unsupported_feature');
    assert.equal(graph.feature, 'graph');
  });

  await t.test('search pages across many hits and cursor continues', () => {
    const { ctx, handler } = contextWithTools(t);
    for (let index = 0; index < 30; index += 1) {
      seed(ctx, { text: `分页关键词第${index}条` });
    }
    const seen = new Set();
    let cursor = null;
    let guard = 0;
    do {
      const page = handler.search({ keywords: '分页关键词', cursor, max_chars: 1000 });
      assert.equal(page.status, 'ok');
      for (const entry of page.hits) {
        assert.equal(seen.has(entry.id), false);
        seen.add(entry.id);
      }
      cursor = page.next_cursor;
      guard += 1;
      assert.ok(guard < 20);
    } while (cursor);
    assert.equal(seen.size, 30);
  });
});

test('M5 memsys_review_get contract', async (t) => {
  await t.test('candidate review entries carry deadline, default outcome and actions', () => {
    const { ctx, handler } = contextWithTools(t);
    const memory = seed(ctx, { text: '待复核候选' });
    const queueId = 'rq_test_1';
    ctx.main
      .prepare(
        `INSERT INTO review_queue
           (id, object_kind, object_id, review_policy, policy_revision, deadline_at,
            created_input_seq, status, close_reason, created_at, updated_at)
         VALUES (?, 'candidate', ?, 'candidate-v1', '1', ?, 0, 'open', NULL, ?, ?)`,
      )
      .run(queueId, memory.promoted_from, ctx.clock.at().at, ctx.clock.at().at, ctx.clock.at().at);
    const page = handler.review({ kind: 'candidate' });
    assert.equal(page.status, 'ok');
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].default_outcome.action, 'review-defer');
    assert.ok(page.entries[0].actions.includes('reject_candidate'));
    assert.equal(page.entries[0].kind, 'candidate');
  });

  await t.test('due-history lists pending-due rows with their state and original text', () => {
    const { ctx, handler } = contextWithTools(t);
    const memory = seed(ctx, { text: '周五前交报告', dueState: 'pending-due' });
    ctx.main
      .prepare(
        `INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason)
         VALUES (?, 'pending-due', 1, ?, NULL, NULL, 0, 'promote')`,
      )
      .run(memory.id, ctx.clock.at().at);
    const page = handler.review({ kind: 'due-history' });
    assert.equal(page.status, 'ok');
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].object_id, memory.id);
    assert.equal(page.entries[0].status, 'pending-due');
    assert.equal(page.entries[0].text, '周五前交报告');
  });
});

test('M5 memsys_context_get and activity', async (t) => {
  await t.test('context_get serves the persisted snapshot group page', () => {
    const { ctx, handler } = contextWithTools(t);
    seed(ctx, { text: '上下文分组一' });
    const compiled = compileRound({
      main: ctx.main,
      control: ctx.control,
      clock: ctx.clock,
      mode: 'work',
      roundId: 'm5-round-1',
      tokenizer: conservativeTokens,
      H: 20000,
    });
    const group = compiled.groups[0];
    const page = handler.context({
      snapshot_revision: compiled.snapshot_revision,
      group_id: group.group_id,
      max_chars: 1000,
    });
    assert.equal(page.status, 'ok');
    assert.equal(page.group_id, group.group_id);
    const invalid = handler.context({ snapshot_revision: 'x' });
    assert.equal(invalid.code, 'validation_error');
  });

  await t.test('lookup adds uses once per round; used refreshes touch without uses', () => {
    const { ctx, handler } = contextWithTools(t);
    const memory = seed(ctx, { text: '触碰统计' });
    const first = handler.touch({ roundId: 'r-1', memoryId: memory.id, kind: 'lookup' });
    assert.equal(first.status, 'ok');
    assert.equal(first.uses, 1);
    const duplicate = handler.touch({ roundId: 'r-1', memoryId: memory.id, kind: 'lookup' });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.uses, 1);
    const used = handler.touch({ roundId: 'r-2', memoryId: memory.id, kind: 'used' });
    assert.equal(used.status, 'ok');
    assert.equal(used.uses, 1);
    const missing = handler.touch({ roundId: 'r-3', memoryId: 'mem_nope', kind: 'lookup' });
    assert.equal(missing.status, 'missing');
    const uses = listUses(ctx.main);
    assert.equal(uses[0].memoryId, memory.id);
    assert.equal(uses[0].count, 1);
    const stored = ctx.main.prepare('SELECT last_touched_at FROM memories WHERE id = ?').get(memory.id);
    assert.ok(stored.last_touched_at);
  });
});

test('M5 tool schemas and binding boundary', async (t) => {
  await t.test('schemas reject unknown fields and out-of-range budgets', () => {
    assert.equal(validateToolArgs('memsys_get', { ids: ['a'], max_chars: 10 }).ok, false);
    assert.equal(validateToolArgs('memsys_get', { ids: ['a'], extra: true }).ok, false);
    assert.equal(validateToolArgs('memsys_get', { ids: ['a', 'a'] }).ok, false);
    assert.equal(validateToolArgs('memsys_get', { ids: ['a'], max_chars: 1000 }).ok, true);
    assert.equal(validateToolArgs('memsys_context_get', { snapshot_revision: 's' }).ok, false);
    assert.equal(validateToolArgs('unknown_tool', {}).ok, false);
  });

  await t.test('host tool registration degrades to tools-only without a host', async () => {
    const offline = await registerHostTools({ handlers: {} });
    assert.equal(offline.status, 'tools_only');
    assert.deepEqual(offline.registered, []);

    const bound = [];
    const host = { tools: { register: (tool) => bound.push(tool.name) } };
    const result = await registerHostTools({
      ctx: host,
      defineTool: (spec) => spec,
      handlers: Object.fromEntries(
        ['memsys_get', 'memsys_search', 'memsys_review_get', 'memsys_context_get', 'memsys_record'].map((name) => [name, () => ({})]),
      ),
    });
    assert.equal(result.status, 'registered');
    assert.equal(bound.length, MEMSYS_TOOLS.length);
    assert.equal(toolCapabilityStatus().status, 'unknown');
  });
});
