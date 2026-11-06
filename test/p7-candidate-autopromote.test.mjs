import assert from 'node:assert/strict';
import test from 'node:test';

import { getMemories } from '../src/read/get.mjs';
import { reviewGet } from '../src/read/review.mjs';
import { replayMain } from '../src/storage/replay.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import { recordCandidates, revokeAutoPromotedMemory } from '../src/write/candidate.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { createTestContext, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

const AUTO_TAG = 'auto-promoted';

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

function byteSpan(text) {
  return `bytes:0:${Buffer.byteLength(text, 'utf8')}`;
}

function countRows(ctx, table) {
  return ctx.main.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function relationCount(ctx, type) {
  return ctx.main.prepare('SELECT COUNT(*) AS n FROM relations WHERE type = ?').get(type).n;
}

/** Model-side candidate item for one ingested observation. */
function itemFor(ingested, text, extra = {}) {
  return {
    observationId: ingested.observation.id,
    text,
    why: '测试候选',
    type: 'fact',
    evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: byteSpan(text) }],
    ...extra,
  };
}

function ownerRuntime() {
  return { role: 'owner', identity: 'owner', sessionId: 'owner', callId: 'owner' };
}

/** First resolved-topic statement promotes; returns the record result item. */
function seedResolvedTopic(ctx, runtime, { messageSeq, text, value }) {
  const ingested = ingestInput(runtime, { text, messageSeq }, depsOf(ctx));
  const response = recordCandidates(
    runtime,
    {
      items: [
        itemFor(ingested, text, {
          type: 'preference',
          structuredValue: { value },
          topicComponents: {
            entityRef: 'entity:owner',
            attributeRef: 'food_preference',
            objectRef: '葱',
          },
        }),
      ],
    },
    depsOf(ctx),
  );
  return { ingested, item: response.items[0] };
}

test('candidate: 首次陈述自动提升是显式的（返回字段 + 记忆标记 + 审计行）', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime();
  const text = '黄金最近在涨，主人在关注金价';
  const ingested = ingestInput(runtime, { text, messageSeq: 1 }, depsOf(ctx));
  const handler = createRecordHandler(depsOf(ctx));

  const responded = handler.record(runtime, {
    kind: 'candidate',
    request_id: 'p7-auto-promote',
    items: [itemFor(ingested, text)],
  });
  const item = responded.items[0];
  assert.equal(item.status, 'found');
  assert.equal(item.promoted, true, JSON.stringify(item));
  assert.equal(item.auto_promoted, true, JSON.stringify(item));
  assert.match(item.memory_id, /^mem_/);

  const memory = ctx.main.prepare('SELECT * FROM memories WHERE id = ?').get(item.memory_id);
  assert.ok(memory, 'the promoted memory exists');
  assert.ok(JSON.parse(memory.tags).includes(AUTO_TAG), memory.tags);

  const queue = ctx.main
    .prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'candidate'")
    .get(item.id);
  assert.equal(queue.status, 'closed');
  assert.equal(queue.close_reason, AUTO_TAG, 'closed audit row names the auto pass');
  assert.equal(relationCount(ctx, 'auto-promote'), 1);

  const review = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'auto-promoted' });
  assert.equal(review.status, 'ok');
  assert.equal(review.total_count, 1);
  assert.equal(review.entries[0].memory_id, item.memory_id);
  assert.equal(review.entries[0].status, 'auto-promoted');
  assert.deepEqual(review.entries[0].actions, ['revoke']);
});

test('candidate: 与已有记忆冲突时进 review_queue(open)，不再自动提升', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime();
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  const first = seedResolvedTopic(ctx, runtime, { messageSeq: 1, text: '我喜欢葱。', value: 'like' });
  assert.equal(first.item.promoted, true);
  const before = countRows(ctx, 'memories');

  const second = ingestInput(runtime, { text: '我不喜欢葱。', messageSeq: 2 }, depsOf(ctx));
  const conflicted = recordCandidates(
    runtime,
    {
      items: [
        itemFor(second, '不喜欢葱', {
          type: 'preference',
          structuredValue: { value: 'dislike' },
          topicComponents: {
            entityRef: 'entity:owner',
            attributeRef: 'food_preference',
            objectRef: '葱',
          },
        }),
      ],
    },
    depsOf(ctx),
  );
  const item = conflicted.items[0];
  assert.equal(item.status, 'found');
  assert.equal(item.promoted, false);
  assert.equal(item.auto_promoted, false);
  assert.equal(item.memory_id, null);
  assert.ok(item.pendingId, 'a conflict opens a pending review row');
  assert.equal(countRows(ctx, 'memories'), before);
  const candidate = ctx.main.prepare('SELECT * FROM candidates WHERE id = ?').get(item.id);
  assert.equal(candidate.status, 'conflicted');
  const queue = ctx.main.prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'pending'").get(item.id);
  assert.equal(queue.status, 'open');
  const review = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'candidate' });
  assert.equal(review.total_count, 0, 'a conflict is pending, not a candidate to confirm');
});

test('candidate: 同 topic 已有记忆时进候选审核，不自动提升', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime();
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  seedResolvedTopic(ctx, runtime, { messageSeq: 1, text: '我喜欢葱。', value: 'like' });
  const before = countRows(ctx, 'memories');

  const second = ingestInput(runtime, { text: '我还是喜欢葱。', messageSeq: 2 }, depsOf(ctx));
  const repeated = recordCandidates(
    runtime,
    {
      items: [
        itemFor(second, '还是喜欢葱', {
          type: 'preference',
          structuredValue: { value: 'like' },
          topicComponents: {
            entityRef: 'entity:owner',
            attributeRef: 'food_preference',
            objectRef: '葱',
          },
        }),
      ],
    },
    depsOf(ctx),
  );
  const item = repeated.items[0];
  assert.equal(item.status, 'found');
  assert.equal(item.promoted, false);
  assert.equal(item.memory_id, null);
  assert.equal(countRows(ctx, 'memories'), before, 'no second memory for the same topic');
  const candidate = ctx.main.prepare('SELECT * FROM candidates WHERE id = ?').get(item.id);
  assert.equal(candidate.status, 'pending');
  const queue = ctx.main
    .prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'candidate'")
    .get(item.id);
  assert.equal(queue.status, 'open', 'same-topic candidate waits for review');
  const review = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'candidate' });
  assert.equal(review.total_count, 1);
  assert.equal(review.entries[0].object_id, item.id);
});

test('candidate: 自动提升的记忆可被主人撤销，审计行保留（不物理删除）', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime();
  const text = '主人在关注黄金价格走势';
  const ingested = ingestInput(runtime, { text, messageSeq: 1 }, depsOf(ctx));
  const responded = recordCandidates(runtime, { items: [itemFor(ingested, text)] }, depsOf(ctx));
  const memoryId = responded.items[0].memory_id;
  assert.match(memoryId, /^mem_/);

  // A model runtime is not allowed to revoke owner-side auto passes.
  assert.throws(
    () => revokeAutoPromotedMemory(fakeRuntime(), memoryId, 'model try', depsOf(ctx)),
    (err) => err?.code === 'invalid_role',
  );

  const revoked = revokeAutoPromotedMemory(ownerRuntime(), memoryId, '记错了', depsOf(ctx));
  assert.equal(revoked.status, 'found');
  assert.equal(revoked.state, 'retired');
  assert.equal(replayMain(ctx.main).memories.get(memoryId), 'retired');

  // Nothing is deleted: memory row and the closed audit row both stay.
  assert.ok(ctx.main.prepare('SELECT 1 AS ok FROM memories WHERE id = ?').get(memoryId));
  const queue = ctx.main
    .prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'candidate'")
    .get(responded.items[0].id);
  assert.equal(queue.status, 'closed');
  assert.equal(queue.close_reason, AUTO_TAG);
  assert.equal(relationCount(ctx, 'demote'), 1);

  const history = getMemories({ main: ctx.main, clock: ctx.clock, ids: [memoryId], view: 'history' });
  assert.equal(history.status, 'ok');
  assert.ok(history.items[0].history.some((entry) => entry.type === 'demote'));

  const review = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'auto-promoted' });
  assert.equal(review.entries[0].status, 'revoked');
  assert.deepEqual(review.entries[0].actions, []);

  // Idempotent: a second click reports the replay instead of double-demoting.
  const again = revokeAutoPromotedMemory(ownerRuntime(), memoryId, '记错了', depsOf(ctx));
  assert.equal(again.replayed, true);
  assert.equal(relationCount(ctx, 'demote'), 1);

  // Only memory ids are revocable through this path; a candidate id is missing.
  assert.throws(
    () => revokeAutoPromotedMemory(ownerRuntime(), responded.items[0].id, 'x', depsOf(ctx)),
    (err) => err?.code === 'memory_missing',
  );
});

test('documented contract: memsys_get(cand_*) answers missing_ids, not candidates', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime();
  const text = '候选 id 不该能被 memsys_get 读到';
  const ingested = ingestInput(runtime, { text, messageSeq: 1 }, depsOf(ctx));
  const responded = recordCandidates(runtime, { items: [itemFor(ingested, text)] }, depsOf(ctx));
  const candidateId = responded.items[0].id;
  const memoryId = responded.items[0].memory_id;

  const byCandidate = getMemories({ main: ctx.main, clock: ctx.clock, ids: [candidateId] });
  assert.equal(byCandidate.status, 'ok');
  assert.equal(byCandidate.items.length, 0);
  assert.deepEqual(byCandidate.missing_ids, [candidateId]);

  const byMemory = getMemories({ main: ctx.main, clock: ctx.clock, ids: [memoryId] });
  assert.equal(byMemory.status, 'ok');
  assert.equal(byMemory.items[0].id, memoryId);
});
