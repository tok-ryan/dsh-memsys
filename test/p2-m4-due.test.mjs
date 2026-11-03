import assert from 'node:assert/strict';
import test from 'node:test';

import { withImmediate } from '../src/storage/open.mjs';
import {
  countRows,
  getMemory,
  getRelationByDedupe,
  insertCandidate,
  insertMemory,
  insertObservation,
  insertTimeline,
  insertPointer,
} from '../src/storage/repositories.mjs';
import { recordCandidates } from '../src/write/candidate.mjs';
import { agePendingDue } from '../src/write/due.mjs';
import { createProject } from '../src/write/project.mjs';
import {
  approveDuePolicy,
  checkDueCapacity,
  duePayloadHash,
  handleOwnerDueCommand,
  parseOwnerDueCommand,
} from '../src/write/due-actions.mjs';
import {
  orderPendingDue,
  selectPendingDue,
  dueTypedId,
} from '../src/context/pending-due.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { getGroupPage } from '../src/context/snapshots.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

function compileBudget(args) {
  let result = compileRound(args);
  if (result.reason === 'budget_exceeded' && Number.isFinite(result.requiredH)) {
    result = compileRound({ ...args, H: result.requiredH });
  }
  return result;
}
import { fakeRuntime } from './helpers/runtime.mjs';

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

function depsOf(ctx, extra = {}) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock, H: 200000, ...extra };
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function seedPending(ctx, count = 1, overrides = {}) {
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    seq += 1;
    const observation = makeObservation(ctx, { messageSeq: 9000 + seq, text: `惦记原话${seq}` });
    insertObservation(ctx.main, observation);
    const item = {
      observationId: observation.id,
      text: `${overrides.text ?? '待确认惦记'}${seq}`,
      why: '有期限，值得记',
      type: 'promise',
      evidenceRefs: [
        { observationId: observation.id, sourceSpan: `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}` },
      ],
    };
    if (overrides.dueAt) {
      item.dueAt = overrides.dueAt;
      item.dueEvidenceRef = observation.id;
    }
    const result = recordCandidates(
      fakeRuntime({ callId: `p4-${seq}`, requestId: `p4-${seq}` }),
      { items: [item] },
      depsOf(ctx),
    );
    assert.equal(result.items[0].status, 'found', JSON.stringify(result.items[0]));
    const candidateId = result.items[0].id;
    const memory = ctx.main
      .prepare('SELECT * FROM memories WHERE idempotency_key = ?')
      .get(`promote:${candidateId}`);
    candidates.push({ candidateId, memory });
  }
  return candidates;
}

function dueRevision(ctx, memoryId) {
  return Number(ctx.main.prepare('SELECT revision FROM due_queue WHERE memory_id = ?').get(memoryId).revision);
}

function compile(ctx, { H = 20000, mode = 'work', roundId = `r-${(seq += 1)}` } = {}) {
  return compileRound({
    ...depsOf(ctx),
    mode,
    roundId,
    tokenizer: conservativeTokens,
    H,
  });
}

test('P2-M4 pending-due recall stays in the review partition', async (t) => {
  await t.test('20 pending items appear only in the review partition', () => {
    const ctx = withContext(t);
    const seeded = seedPending(ctx, 20);
    const compiled = compile(ctx, { roundId: 'p4-full' });
    assert.equal(compiled.delivery_level, 'full');
    assert.equal(compiled.delivery, 'unknown');
    assert.equal(countRows(ctx.main, 'injections'), 0);
    assert.equal(compiled.eligible_ids.length, 20);
    for (const id of compiled.eligible_ids) assert.ok(id.startsWith('review:due:'));
    assert.ok(compiled.section.text.includes('待确认惦记 20 条'));
    for (const item of seeded) assert.ok(compiled.section.text.includes(dueTypedId(item.memory.id)));
    assert.ok(compiled.section.text.includes('[相关记忆]'));
    assert.ok(compiled.section.text.includes('（无）'), 'no fact members are delivered as fixed columns');
    const typed = JSON.parse(
      ctx.control.prepare('SELECT manifest_json FROM context_snapshots WHERE id = ?').get(compiled.snapshot_revision).manifest_json,
    ).typed_items;
    assert.equal(typed.filter((item) => item.kind === 'pending-due').length, 20);
  });

  await t.test('ordering uses tension, mention then enqueue order — and never reorders S', () => {
    const ctx = withContext(t);
    const [past] = seedPending(ctx, 1, { dueAt: '2020-01-01T00:00:00.000Z' });
    const [future] = seedPending(ctx, 1, { dueAt: '2030-01-01T00:00:00.000Z' });
    const [plain] = seedPending(ctx, 1);
    const ordered = orderPendingDue(selectPendingDue({ main: ctx.main, mode: 'work', now: ctx.clock.now() }));
    assert.deepEqual(
      ordered.map((item) => item.id),
      [past.memory.id, future.memory.id, plain.memory.id],
      'overdue > future > no date',
    );

    const mention = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-mention ${plain.memory.id} ${dueRevision(ctx, plain.memory.id)}`,
      inputEventId: 'mention-1',
      ownerId: 'owner',
    });
    assert.equal(mention.ok, true);
    const reordered = orderPendingDue(selectPendingDue({ main: ctx.main, mode: 'work', now: ctx.clock.now() }));
    const zeroTension = reordered.filter((item) => item.tension === 0).map((item) => item.id);
    assert.deepEqual(zeroTension, [plain.memory.id]);

    const before = compile(ctx, { roundId: 'p4-order-before' });
    handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-mention ${future.memory.id} ${dueRevision(ctx, future.memory.id)}`,
      inputEventId: 'mention-2',
      ownerId: 'owner',
    });
    const after = compile(ctx, { roundId: 'p4-order-after' });
    assert.deepEqual(after.snapshot.eligible_ids, before.snapshot.eligible_ids);
  });

  await t.test('scene and source gates filter the recall set', () => {
    const ctx = withContext(t);
    function directPending({ text, scene, scope, credibility }) {
      seq += 1;
      const observation = makeObservation(ctx, { messageSeq: 9800 + seq, text });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation, { businessKey: `p4-direct:${seq}`, text });
      insertCandidate(ctx.main, candidate);
      const memory = makeMemory(ctx, candidate);
      Object.assign(memory, { scene, scope, credibility, due_state: 'pending-due' });
      insertMemory(ctx.main, memory);
      insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
      insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
      ctx.main
        .prepare(
          `INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason)
           VALUES (?, 'pending-due', 1, ?, NULL, NULL, 0, 'promote')`,
        )
        .run(memory.id, ctx.clock.at().at);
      return memory.id;
    }
    const lifeId = directPending({ text: '生活惦记', scene: 'life', scope: 'life-only', credibility: 'unverified' });
    const dreamId = directPending({ text: '梦来源惦记', scene: 'work', scope: 'work-only', credibility: 'from-dream' });
    const workRecall = selectPendingDue({ main: ctx.main, mode: 'work', now: ctx.clock.now() });
    assert.equal(workRecall.some((item) => item.id === lifeId), false);
    assert.equal(workRecall.some((item) => item.id === dreamId), false);
    const lifeRecall = selectPendingDue({ main: ctx.main, mode: 'life', now: ctx.clock.now() });
    assert.equal(lifeRecall.some((item) => item.id === lifeId), true);
  });

  await t.test('grouped delivery carries the review group, counts and fetch args; traversal is complete', () => {
    const ctx = withContext(t);
    const seeded = seedPending(ctx, 20);
    const overflow = compileRound({ ...depsOf(ctx), mode: 'work', roundId: 'p4-probe', tokenizer: conservativeTokens, H: 1 });
    assert.equal(overflow.delivery_level, 'protected_overflow');
    const grouped = compileBudget({ ...depsOf(ctx), mode: 'work', roundId: 'p4-grouped', tokenizer: conservativeTokens, H: overflow.hard.tokens + 1 });
    assert.equal(grouped.delivery_level, 'grouped');
    assert.equal(grouped.capacity_insufficient, true);
    const reviewGroup = grouped.groups.find((group) => group.group_id === 'work:review');
    assert.ok(reviewGroup, 'review group exists');
    assert.equal(reviewGroup.deferred_count, 20);
    assert.equal(reviewGroup.fetch.args.group_id, 'work:review');
    assert.equal(reviewGroup.fetch.args.snapshot_revision, grouped.snapshot_revision);
    assert.ok(grouped.section.text.includes('未展开 20 条'));
    assert.equal(grouped.section.text.includes('另有'), false);

    const visited = new Set();
    let cursor = null;
    do {
      const page = getGroupPage({
        control: ctx.control,
        clock: ctx.clock,
        snapshotRevision: grouped.snapshot_revision,
        groupId: 'work:review',
        cursor,
        maxChars: 1000,
      });
      assert.equal(page.status, 'ok');
      for (const item of page.items) visited.add(item.id);
      cursor = page.next_cursor;
    } while (cursor);
    assert.deepEqual([...visited].sort(), seeded.map((item) => dueTypedId(item.memory.id)).sort());
  });
});

test('P2-M4 confirmation loop and capacity', async (t) => {
  await t.test('confirm is closed until due-policy-v1 is approved', () => {
    const ctx = withContext(t);
    const [item] = seedPending(ctx, 1);
    const revision = dueRevision(ctx, item.memory.id);
    const blocked = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${item.memory.id} ${revision} ${duePayloadHash(item.memory.id, revision)}`,
      inputEventId: 'confirm-before-policy',
      ownerId: 'owner',
    });
    assert.equal(blocked.code, 'policy_not_approved');
    assert.equal(getMemory(ctx.main, item.memory.id).due_state, 'pending-due');
  });

  await t.test('a whole owner command confirms one pending item into open, new snapshot only', () => {
    const ctx = withContext(t);
    const seeded = seedPending(ctx, 20);
    const [first] = seeded;
    const before = compile(ctx, { roundId: 'p4-before-confirm' });
    const approved = handleOwnerDueCommand(depsOf(ctx), {
      text: '/mem due-policy-approve due-policy-v1',
      inputEventId: 'policy-1',
      ownerId: 'owner',
    });
    assert.equal(approved.ok, true);
    const revision = dueRevision(ctx, first.memory.id);
    const confirmed = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${first.memory.id} ${revision} ${duePayloadHash(first.memory.id, revision)}`,
      inputEventId: 'confirm-1',
      ownerId: 'owner',
    });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    const memory = getMemory(ctx.main, first.memory.id);
    assert.equal(memory.due_state, 'open');
    assert.equal(memory.due_done_at, null);
    const queue = ctx.main.prepare('SELECT * FROM due_queue WHERE memory_id = ?').get(first.memory.id);
    assert.ok(queue.opened_at);
    assert.equal(Number(queue.revision), revision + 1);

    const after = compile(ctx, { roundId: 'p4-after-confirm' });
    // The opened item leaves D and joins the fact set (P_s); D itself is 19.
    assert.equal(after.eligible_ids.filter((id) => id.startsWith('review:due:')).length, 19);
    assert.ok(after.eligible_ids.includes(first.memory.id));
    const oldGroup = ctx.control
      .prepare('SELECT total_count FROM snapshot_groups WHERE snapshot_id = ? AND group_id = ?')
      .get(before.snapshot_revision, 'work:review');
    assert.equal(Number(oldGroup.total_count), 20, 'old snapshot keeps its own recall set');
  });

  await t.test('stale revision and wrong hash are refused without changing state', () => {
    const ctx = withContext(t);
    const [item] = seedPending(ctx, 1);
    handleOwnerDueCommand(depsOf(ctx), { text: '/mem due-policy-approve due-policy-v1', inputEventId: 'policy-2', ownerId: 'owner' });
    const revision = dueRevision(ctx, item.memory.id);
    const stale = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${item.memory.id} ${revision + 6} ${duePayloadHash(item.memory.id, revision)}`,
      inputEventId: 'confirm-stale',
      ownerId: 'owner',
    });
    assert.equal(stale.code, 'stale_proposal');
    const wrongHash = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${item.memory.id} ${revision} ${'0'.repeat(32)}`,
      inputEventId: 'confirm-hash',
      ownerId: 'owner',
    });
    assert.equal(wrongHash.code, 'due_hash_mismatch');
    assert.equal(getMemory(ctx.main, item.memory.id).due_state, 'pending-due');
  });

  await t.test('capacity blocks a confirmation instead of silently dropping the item', () => {
    const ctx = withContext(t);
    const seeded = seedPending(ctx, 2);
    handleOwnerDueCommand(depsOf(ctx), { text: '/mem due-policy-approve due-policy-v1', inputEventId: 'policy-3', ownerId: 'owner' });
    const first = seeded[0];
    handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${first.memory.id} ${dueRevision(ctx, first.memory.id)} ${duePayloadHash(first.memory.id, dueRevision(ctx, first.memory.id))}`,
      inputEventId: 'confirm-cap-1',
      ownerId: 'owner',
    });
    const second = seeded[1];
    const revision = dueRevision(ctx, second.memory.id);
    const blocked = handleOwnerDueCommand(
      depsOf(ctx, { dueLimits: { members: 1, bytes: 12288, hRatio: 0.6 } }),
      {
        text: `/mem due-confirm ${second.memory.id} ${revision} ${duePayloadHash(second.memory.id, revision)}`,
        inputEventId: 'confirm-cap-2',
        ownerId: 'owner',
      },
    );
    assert.equal(blocked.code, 'due_capacity_blocked');
    assert.equal(getMemory(ctx.main, second.memory.id).due_state, 'pending-due');
    const capacity = checkDueCapacity(ctx.main, { H: 200000 });
    assert.equal(capacity.ok, true);
  });

  await t.test('done sets due_done_at; dropped does not; restore returns to open', () => {
    const ctx = withContext(t);
    handleOwnerDueCommand(depsOf(ctx), { text: '/mem due-policy-approve due-policy-v1', inputEventId: 'policy-4', ownerId: 'owner' });
    const seeded = seedPending(ctx, 3);
    for (const item of seeded.slice(0, 2)) {
      const revision = dueRevision(ctx, item.memory.id);
      handleOwnerDueCommand(depsOf(ctx), {
        text: `/mem due-confirm ${item.memory.id} ${revision} ${duePayloadHash(item.memory.id, revision)}`,
        inputEventId: `confirm-${item.memory.id}`,
        ownerId: 'owner',
      });
    }
    const done = seeded[0];
    const doneResult = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-done ${done.memory.id} ${dueRevision(ctx, done.memory.id)} done`,
      inputEventId: 'done-1',
      ownerId: 'owner',
    });
    assert.equal(doneResult.ok, true);
    assert.ok(getMemory(ctx.main, done.memory.id).due_done_at);
    const dropped = seeded[1];
    const droppedResult = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-done ${dropped.memory.id} ${dueRevision(ctx, dropped.memory.id)} dropped`,
      inputEventId: 'drop-1',
      ownerId: 'owner',
    });
    assert.equal(droppedResult.ok, true);
    assert.equal(getMemory(ctx.main, dropped.memory.id).due_done_at, null);

    ctx.main.prepare("UPDATE memories SET due_state = 'shelved-due' WHERE id = ?").run(seeded[2].memory.id);
    const restore = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-restore ${seeded[2].memory.id} ${dueRevision(ctx, seeded[2].memory.id)}`,
      inputEventId: 'restore-1',
      ownerId: 'owner',
    });
    assert.equal(restore.ok, true, JSON.stringify(restore));
    const restoredRow = getMemory(ctx.main, seeded[2].memory.id);
    assert.equal(restoredRow.due_state, 'pending-due', 'shelved-due must return to pending-due first');
    assert.equal(restoredRow.due_done_at, null);
  });

  await t.test('14 days without confirmation shelves the item, text and facts untouched', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const [item] = (() => {
      const observation = makeObservation(ctx, { messageSeq: 9600, text: '十四天原话' });
      insertObservation(ctx.main, observation);
      const result = recordCandidates(
        fakeRuntime({ callId: 'p4-14', requestId: 'p4-14' }),
        { items: [{ observationId: observation.id, text: '十四天惦记', why: '期限', type: 'promise', evidenceRefs: [{ observationId: observation.id, sourceSpan: `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}` }] }] },
        deps,
      );
      const candidateId = result.items[0].id;
      return [{ candidateId, memory: ctx.main.prepare('SELECT * FROM memories WHERE idempotency_key = ?').get(`promote:${candidateId}`) }];
    })();
    const beforeText = item.memory.text;
    clockPair.advance(15 * DAY);
    const aged = agePendingDue(ctx.main, { clock: clockPair.clock });
    assert.equal(aged.aged, 1);
    const after = getMemory(ctx.main, item.memory.id);
    assert.equal(after.due_state, 'shelved-due');
    assert.equal(after.text, beforeText);
    assert.equal(selectPendingDue({ main: ctx.main, mode: 'work', now: clockPair.clock.now() }).length, 0);
  });

  await t.test('the 101st pending item shelves the oldest and keeps the cap at 100', () => {
    const ctx = withContext(t);
    const seeded = seedPending(ctx, 101);
    const pending = ctx.main.prepare("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'pending-due'").get();
    const shelved = ctx.main.prepare("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'shelved-due'").get();
    assert.equal(Number(pending.n), 100);
    assert.equal(Number(shelved.n), 1);
    assert.equal(getMemory(ctx.main, seeded[0].memory.id).due_state, 'shelved-due');
  });

  await t.test('project capacity is blocked instead of silently accepted', () => {
    const ctx = withContext(t);
    const receipt = withImmediate(ctx.main, () =>
      issueReceipt(ctx.main, ctx.clock, {
        ownerId: 'owner',
        proposalId: 'project-cap',
        action: 'project-create',
        payloadHash: 'h',
        targetIds: [],
        baseVersions: [],
        nonce: 'n',
        inputEventId: 'e',
      }),
    );
    const blocked = createProject(depsOf(ctx), { name: 'x'.repeat(13000), receiptId: receipt.receiptId, snapshot: {} });
    assert.equal(blocked.code, 'project_capacity_blocked');
  });

  await t.test('commands parse only as whole trusted messages', () => {
    assert.equal(parseOwnerDueCommand('/mem due-confirm mem_1 0 ' + 'a'.repeat(16)).command, 'due-confirm');
    assert.equal(parseOwnerDueCommand('请帮我 /mem due-confirm mem_1 0 ' + 'a'.repeat(16)), null);
    assert.equal(parseOwnerDueCommand('`/mem due-confirm mem_1 0 ' + 'a'.repeat(16) + '`'), null);
    const ctx = withContext(t);
    const notCommand = handleOwnerDueCommand(depsOf(ctx), { text: '对啊', inputEventId: 'x', ownerId: 'owner' });
    assert.equal(notCommand.code, 'not_a_due_command');
  });

  await t.test('marker', (t2) => {
    const ctx = withContext(t2);
    const seeded = seedPending(ctx, 20);
    const overflow = compileRound({ ...depsOf(ctx), mode: 'work', roundId: 'p4-marker-probe', tokenizer: conservativeTokens, H: 1 });
    const grouped = compileBudget({ ...depsOf(ctx), mode: 'work', roundId: 'p4-marker', tokenizer: conservativeTokens, H: overflow.hard.tokens + 1 });
    assert.equal(grouped.delivery_level, 'grouped');
    const reviewGroup = grouped.groups.find((group) => group.group_id === 'work:review');
    assert.equal(reviewGroup.deferred_count, 20);
    handleOwnerDueCommand(depsOf(ctx), { text: '/mem due-policy-approve due-policy-v1', inputEventId: 'marker-policy', ownerId: 'owner' });
    const first = seeded[0];
    const revision = dueRevision(ctx, first.memory.id);
    const confirmed = handleOwnerDueCommand(depsOf(ctx), {
      text: `/mem due-confirm ${first.memory.id} ${revision} ${duePayloadHash(first.memory.id, revision)}`,
      inputEventId: 'marker-confirm',
      ownerId: 'owner',
    });
    const pendingBefore = 20;
    const pendingAfter = selectPendingDue({ main: ctx.main, mode: 'work', now: ctx.clock.now() }).length;
    const groupedComplete = grouped.section.text.includes('未展开 20 条');
    // D never occupies the protected set: every eligible id is a typed review id.
    const pendingInP = grouped.eligible_ids.some((id) => !id.startsWith('review:due:'));
    const confirmedOpen = confirmed.ok && getMemory(ctx.main, first.memory.id).due_state === 'open';
    assert.equal(pendingAfter, 19);
    assert.equal(groupedComplete, true);
    assert.equal(pendingInP, false);
    assert.equal(confirmedOpen, true);
    t2.diagnostic(`P2_M4_OK pending=${pendingBefore} grouped_complete=${groupedComplete} pending_in_P=${pendingInP ? 1 : 0} confirmed_open=${confirmedOpen ? 1 : 0}`);
  });
});
