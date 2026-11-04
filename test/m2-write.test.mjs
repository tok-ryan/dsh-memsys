import assert from 'node:assert/strict';
import test from 'node:test';

import { readExactObservation } from '../src/control/readback.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import {
  countRows,
  getCandidate,
  getMemory,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertObservation,
  listCandidateEntities,
  listEvidence,
} from '../src/storage/repositories.mjs';
import { promoteInTransaction } from '../src/write/promote.mjs';
import { matchCaptureCommand } from '../src/write/capture.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import {
  promoteCandidate,
  recordCandidates,
  rejectCandidate,
} from '../src/write/candidate.mjs';
import { proposeOwnerAction, scanReviews } from '../src/write/review.mjs';
import { agePendingDue, getDueState } from '../src/write/due.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import {
  createTestContext,
  makeCandidate,
  makeObservation,
  mutableClock,
  registerEntity,
} from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

const DAY = 24 * 60 * 60 * 1000;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

function counts(ctx) {
  return {
    obs: countRows(ctx.main, 'observations'),
    cand: countRows(ctx.main, 'candidates'),
    mem: countRows(ctx.main, 'memories'),
    rel: countRows(ctx.main, 'relations'),
  };
}

function relationCount(ctx, type) {
  return Number(ctx.main.prepare('SELECT COUNT(*) AS n FROM relations WHERE type = ?').get(type).n);
}

function withContext(t, options = {}) {
  const ctx = createTestContext(options);
  t.after(() => ctx.cleanup());
  return ctx;
}

function addCandidateEvidence(ctx, candidate, observation, span) {
  insertEvidence(ctx.main, {
    id: `ev_${candidate.id}_${span}`,
    memory_id: null,
    candidate_id: candidate.id,
    observation_id: observation.id,
    source_memory_id: null,
    role: 'basis',
    source_span: span,
    at: ctx.clock.at().at,
  });
}

test('M2 path A: observation and capture', async (t) => {
  await t.test('a normal message yields 1 observation, 1 capture candidate, 0 memories', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const result = ingestInput(runtime, { text: '不吃葱。', messageSeq: 1 }, depsOf(ctx));
    assert.equal(result.receipt.status, 'found');
    const totals = counts(ctx);
    assert.deepEqual({ obs: totals.obs, cand: totals.cand, mem: totals.mem }, { obs: 1, cand: 1, mem: 0 });
    const capture = getCandidate(ctx.main, result.capture.id);
    assert.equal(capture.source_path, 'capture');
    assert.equal(capture.status, 'pending');
    assert.equal(capture.semantic_status, 'quoted');
    assert.equal(capture.record_kind, 'utterance');
    assert.equal(capture.type, 'episode');
    assert.equal(capture.why, '输入原话留存，待提炼');
    assert.equal(capture.text, '不吃葱。');
    assert.ok(capture.topic_key.startsWith('unresolved:'));
    assert.equal(capture.scene, 'work');
    assert.equal(capture.scope, 'work-only');
    assert.equal(listEvidence(ctx.main, 'candidate', capture.id).length, 1);
    const seq = JSON.parse(ctx.main.prepare("SELECT value FROM state WHERE key = 'input-seq:test-owner'").get().value);
    assert.equal(seq.value, 1);
  });

  await t.test('a repeated callback does not duplicate observation, capture or input sequence', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    ingestInput(runtime, { text: '不吃葱。', messageSeq: 2 }, depsOf(ctx));
    const before = counts(ctx);
    const again = ingestInput(runtime, { text: '不吃葱。', messageSeq: 2 }, depsOf(ctx));
    assert.equal(again.replayed, true);
    assert.deepEqual(counts(ctx), before);
    const seq = JSON.parse(ctx.main.prepare("SELECT value FROM state WHERE key = 'input-seq:test-owner'").get().value);
    assert.equal(seq.value, 1);
  });

  await t.test('the exact 记住 command creates one quoted memory and shelves the capture', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const result = ingestInput(runtime, { text: '记住：不吃葱。', messageSeq: 1 }, depsOf(ctx));
    assert.equal(result.receipt.status, 'found');
    assert.ok(result.memory, 'quoted memory must exist');
    assert.equal(result.memory.text, '不吃葱。');
    assert.equal(result.memory.semantic_status, 'quoted');
    assert.equal(result.memory.record_kind, 'utterance');
    assert.equal(result.memory.due_state, 'none');
    assert.equal(result.capture.status, 'shelved');
    assert.equal(result.capture.reason, 'explicit_capture_promoted');
    assert.equal(countRows(ctx.main, 'memories'), 1);
    assert.equal(relationCount(ctx, 'promote'), 1);
    const quote = ctx.main
      .prepare("SELECT * FROM candidates WHERE source_unit = 'command_body'")
      .get();
    assert.ok(quote);
    assert.equal(quote.status, 'promoted');
    assert.equal(quote.text, '不吃葱。');
  });

  await t.test('near-miss command text is never treated as an owner command', () => {
    const cases = ['请记住：不吃葱。', '记住：', '记住: 不吃葱。', '记住：   '];
    for (const text of cases) {
      assert.equal(matchCaptureCommand(text).matched, false, text);
    }
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    ingestInput(runtime, { text: '请记住：不吃葱。', messageSeq: 1 }, depsOf(ctx));
    assert.equal(countRows(ctx.main, 'memories'), 0);
    assert.equal(countRows(ctx.main, 'candidates'), 1);
  });

  await t.test('a failing command transaction leaves no memory and keeps the observation', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const failing = {
      faultInjector: {
        promoteHooks: {
          beforeStep(index) {
            if (index === 3) throw new Error('injected_step_failure');
          },
        },
      },
    };
    const result = ingestInput(
      runtime,
      { text: '记住：不吃葱。', messageSeq: 1 },
      { ...depsOf(ctx), ...failing },
    );
    assert.equal(result.captureReceipt.status, 'unknown');
    assert.equal(countRows(ctx.main, 'memories'), 0);
    assert.equal(countRows(ctx.main, 'candidates'), 0, 'command txn must roll back the capture row too');
    const observation = getObservation(ctx.main, result.observation.id);
    assert.ok(observation, 'observation must survive the failed candidate work');
    assert.equal(observation.text, '记住：不吃葱。');
    const readback = readExactObservation(ctx.main, observation);
    assert.equal(readback.status, 'found');

    const retry = ingestInput(runtime, { text: '记住：不吃葱。', messageSeq: 1 }, depsOf(ctx));
    assert.ok(retry.memory);
    assert.equal(countRows(ctx.main, 'memories'), 1);
    assert.equal(countRows(ctx.main, 'observations'), 1);
  });

  await t.test('another user input cannot forge an owner command from quoted context', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    ingestInput(runtime, { text: '他说“记住：吃葱”。', messageSeq: 1 }, depsOf(ctx));
    assert.equal(countRows(ctx.main, 'memories'), 0);
    assert.equal(countRows(ctx.main, 'candidates'), 1);
  });

  await t.test('life window capture defaults to life/life-only', () => {
    const ctx = withContext(t, { mode: 'life' });
    const runtime = fakeRuntime({ mode: 'life', phase: 'life' });
    const result = ingestInput(runtime, { text: '想吃米饭。', messageSeq: 1 }, depsOf(ctx));
    assert.equal(result.capture.scene, 'life');
    assert.equal(result.capture.scope, 'life-only');
  });
});

test('M2 promotion: six steps are atomic', async (t) => {
  await t.test('every failing step leaves no half memory and the candidate still pending', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    for (let step = 0; step < 6; step += 1) {
      const observation = makeObservation(ctx, { messageSeq: 100 + step, text: `第${step}步` });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation, {
        businessKey: `promote-fail:${step}`,
        text: `第${step}步断言`,
        why: '测试六步回滚',
      });
      insertCandidate(ctx.main, candidate);
      addCandidateEvidence(ctx, candidate, observation, `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}`);
      const dependencies = {
        ...depsOf(ctx),
        faultInjector: {
          promoteHooks: {
            beforeStep(index) {
              if (index === step) throw new Error(`injected_step_${step}`);
            },
          },
        },
      };
      const result = promoteCandidate(runtime, candidate.id, null, dependencies);
      assert.equal(result.status, 'unknown', `step ${step} must fail`);
      assert.equal(countRows(ctx.main, 'memories'), 0, `step ${step} must not leave a memory`);
      const stored = getCandidate(ctx.main, candidate.id);
      assert.equal(stored.status, 'pending');
      assert.equal(
        ctx.main.prepare('SELECT COUNT(*) AS n FROM timeline WHERE memory_id LIKE ?').get(`%${candidate.id}%`).n,
        0,
      );
      assert.equal(getObservation(ctx.main, observation.id).text, observation.text);
    }
    assert.equal(countRows(ctx.main, 'memories'), 0);
  });

  await t.test('a successful promotion maps content, freezes snapshot and writes due projection', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const observation = makeObservation(ctx, { messageSeq: 300, text: '周五前交报告。' });
    insertObservation(ctx.main, observation);
    const candidate = makeCandidate(ctx, observation, {
      businessKey: 'promote-ok:1',
      text: '周五前交报告',
      why: '有期限，值得记',
      type: 'promise',
      dueAt: '2026-11-07T00:00:00.000Z',
      semanticStatus: 'proposed',
      recordKind: 'assertion',
    });
    insertCandidate(ctx.main, candidate);
    addCandidateEvidence(ctx, candidate, observation, 'bytes:0:21');
    const result = promoteCandidate(runtime, candidate.id, candidate.payload_hash, depsOf(ctx));
    assert.equal(result.status, 'found');
    const memory = getMemory(ctx.main, result.id);
    assert.equal(memory.text, '周五前交报告');
    assert.equal(memory.due_state, 'pending-due');
    assert.equal(memory.due_done_at, null);
    assert.equal(memory.recorded_at, memory.last_touched_at);
    assert.equal(memory.semantic_status, 'proposed');
    assert.equal(memory.credibility, 'verified');
    assert.equal(getCandidate(ctx.main, candidate.id).status, 'promoted');
    assert.equal(getDueState(ctx.main, memory.id), 'pending-due');
    assert.equal(relationCount(ctx, 'promote'), 1);
  });
});

test('M2 path B: model candidates and boundaries', async (t) => {
  await t.test('an unregistered ingredient is promoted immediately as ungrouped proposed', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const response = recordCandidates(
      runtime,
      {
        requestId: 'req-unregistered',
        items: [
          {
            observationId: ingested.observation.id,
            text: '不喜欢刺角瓜',
            why: '会改变选食材',
            type: 'preference',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:3:21' }],
            topicComponents: { entityRef: '刺角瓜', attributeRef: 'food_preference', objectRef: null },
            entityMention: { sourceSpan: 'bytes:12:21' },
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(response.items[0].status, 'found');
    assert.equal(response.items[0].error, null);
    const memory = ctx.main
      .prepare('SELECT * FROM memories ORDER BY recorded_at DESC, id DESC LIMIT 1')
      .get();
    assert.equal(memory.semantic_status, 'proposed');
    assert.equal(memory.record_kind, 'assertion');
    assert.ok(memory.topic_key.startsWith('unresolved:'));
    assert.equal(memory.credibility, 'unverified');
    assert.match(memory.origin, /model_inference/);
    const mentions = listCandidateEntities(ctx.main, ingested.observation.id);
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].status, 'candidate');
    assert.equal(mentions[0].scope_id, 'work');
  });

  await t.test('a repeated tool call is idempotent', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const request = {
      requestId: 'req-same',
      items: [
        {
          observationId: ingested.observation.id,
          text: '不喜欢刺角瓜',
          why: '会改变选食材',
          type: 'preference',
          evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:3:21' }],
        },
      ],
    };
    recordCandidates(runtime, request, depsOf(ctx));
    const before = counts(ctx);
    const again = recordCandidates(runtime, request, depsOf(ctx));
    assert.equal(again.items[0].replayed, true);
    assert.deepEqual(counts(ctx), before);
  });

  await t.test('a changed negation is a new candidate, never a dedupe hit', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const first = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const second = ingestInput(runtime, { text: '我喜欢刺角瓜。', messageSeq: 2 }, depsOf(ctx));
    const makeItem = (observation, span) => ({
      observationId: observation.id,
      text: '刺角瓜偏好',
      why: '会改变选食材',
      type: 'preference',
      evidenceRefs: [{ observationId: observation.id, sourceSpan: span }],
    });
    recordCandidates(runtime, { items: [makeItem(first.observation, 'bytes:3:21')] }, depsOf(ctx));
    recordCandidates(runtime, { items: [makeItem(second.observation, 'bytes:0:18')] }, depsOf(ctx));
    const toolCandidates = ctx.main
      .prepare("SELECT * FROM candidates WHERE source_path = 'tool'")
      .all();
    assert.equal(toolCandidates.length, 2);
    assert.equal(countRows(ctx.main, 'memories'), 2);
  });

  await t.test('evidence spans are verified against stored bytes', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const response = recordCandidates(
      runtime,
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '不喜欢刺角瓜',
            why: '会改变选食材',
            type: 'preference',
            evidenceRefs: [
              { observationId: ingested.observation.id, sourceSpan: 'bytes:3:21', quote: '不喜欢苹果' },
            ],
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(response.items[0].error, 'evidence_span_mismatch');
    assert.equal(
      ctx.main.prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'tool'").get().n,
      0,
    );
  });

  await t.test('model cannot forge origin, accepted status or due open', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const base = {
      observationId: ingested.observation.id,
      text: '不喜欢刺角瓜',
      why: '会改变选食材',
      type: 'preference',
      evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:3:21' }],
    };
    for (const extra of [
      { origin: 'master@2026-11-03' },
      { semanticStatus: 'accepted' },
      { topicKey: 'tk:deadbeef' },
      { dueState: 'open' },
    ]) {
      const response = recordCandidates(runtime, { items: [{ ...base, ...extra }] }, depsOf(ctx));
      assert.equal(response.items[0].error, 'validation_error', JSON.stringify(extra));
    }
    assert.equal(
      ctx.main.prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'tool'").get().n,
      0,
    );
  });

  await t.test('model audit times are dropped and recorded as violations', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const response = recordCandidates(
      runtime,
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '不喜欢刺角瓜',
            why: '会改变选食材',
            type: 'preference',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:3:21' }],
            at: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(response.items[0].status, 'found');
    const memory = ctx.main.prepare('SELECT * FROM memories LIMIT 1').get();
    assert.notEqual(memory.recorded_at, '2020-01-01T00:00:00.000Z');
    assert.equal(relationCount(ctx, 'violation'), 1);
  });
});

test('M2 resolved topics: review, conflict and coexist', async (t) => {
  await t.test('a resolved topic with a different value becomes conflicted, then coexist at deadline', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    const first = ingestInput(runtime, { text: '我喜欢葱。', messageSeq: 1 }, depsOf(ctx));
    const second = ingestInput(runtime, { text: '我不喜欢葱。', messageSeq: 2 }, depsOf(ctx));
    const item = (observation, span, value) => ({
      observationId: observation.id,
      text: value === 'like' ? '喜欢葱' : '不喜欢葱',
      why: '口味',
      type: 'preference',
      structuredValue: { value },
      evidenceRefs: [{ observationId: observation.id, sourceSpan: span }],
      topicComponents: {
        entityRef: 'entity:owner',
        attributeRef: 'food_preference',
        objectRef: '葱',
      },
    });
    const one = recordCandidates(runtime, { items: [item(first.observation, 'bytes:3:6', 'like')] }, depsOf(ctx));
    assert.equal(one.items[0].status, 'found');
    const promoted = ctx.main.prepare("SELECT * FROM memories WHERE structured_value = ?").get('{"value":"like"}');
    assert.ok(promoted, 'first resolved candidate promotes');
    assert.ok(promoted.topic_key.startsWith('tk:'));

    const two = recordCandidates(runtime, { items: [item(second.observation, 'bytes:3:9', 'dislike')] }, depsOf(ctx));
    assert.equal(two.items[0].status, 'found');
    assert.equal(two.items[0].pendingId !== null, true, 'conflict must open a pending row');
    const conflicted = getCandidate(ctx.main, two.items[0].id);
    assert.equal(conflicted.status, 'conflicted');
    assert.equal(conflicted.semantic_status, 'proposed');
    assert.equal(relationCount(ctx, 'conflict'), 1);

    const beforeMemories = countRows(ctx.main, 'memories');
    const queueForDeadline = ctx.main.prepare("SELECT deadline_at FROM review_queue WHERE object_id = ?").get(two.items[0].id);
    const clockPair = mutableClock();
    clockPair.advance(Math.max(DAY + 1000, Date.parse(queueForDeadline.deadline_at) - clockPair.clock.now().getTime() + 1000));
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const summary = scanReviews(runtime, 2, deps);
    assert.equal(summary.coexisted, 1);
    assert.equal(countRows(ctx.main, 'memories'), beforeMemories + 1);
    const shelved = getCandidate(ctx.main, two.items[0].id);
    assert.equal(shelved.status, 'shelved');
    const queue = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'pending'")
      .get(two.items[0].id);
    assert.equal(queue.status, 'closed');
    assert.equal(queue.close_reason, 'coexist');
    assert.equal(relationCount(ctx, 'pending-resolve'), 1);
  });

  await t.test('alias zero-hit and multi-hit both stay unresolved', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    registerEntity(ctx, { id: 'entity:ingredient:leek', canonical: '韭葱', alias: '葱' });
    const observed = ingestInput(runtime, { text: '我喜欢葱。', messageSeq: 1 }, depsOf(ctx));
    const response = recordCandidates(
      runtime,
      {
        items: [
          {
            observationId: observed.observation.id,
            text: '喜欢葱',
            why: '口味',
            type: 'preference',
            evidenceRefs: [{ observationId: observed.observation.id, sourceSpan: 'bytes:3:6' }],
            topicComponents: {
              entityRef: 'entity:owner',
              attributeRef: 'food_preference',
              objectRef: '葱',
            },
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(response.items[0].status, 'found');
    const memory = ctx.main
      .prepare('SELECT * FROM memories ORDER BY recorded_at DESC, id DESC LIMIT 1')
      .get();
    assert.ok(memory.topic_key.startsWith('unresolved:'));
  });
});

test('M2 deadlines, due projections and default exits', async (t) => {
  await t.test('capture candidates shelve after 24 hours without semantic output', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '今天天气不错。', messageSeq: 1 }, deps);
    const before = getCandidate(ctx.main, ingested.capture.id);
    assert.equal(before.status, 'pending');
    clockPair.advance(DAY + 1000);
    const summary = scanReviews(runtime, 1, deps);
    assert.equal(summary.shelvedCaptures, 1);
    const after = getCandidate(ctx.main, ingested.capture.id);
    assert.equal(after.status, 'shelved');
    const shelveEvent = ctx.main
      .prepare("SELECT payload FROM relations WHERE type = 'shelve' AND json_extract(payload, '$.targetId') = ?")
      .get(ingested.capture.id);
    assert.equal(JSON.parse(shelveEvent.payload).reason, 'raw_capture_unreviewed');
    assert.equal(getObservation(ctx.main, ingested.observation.id).text, '今天天气不错。');
  });

  await t.test('capture candidates also shelve after three subsequent real inputs', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const deps = depsOf(ctx);
    const first = ingestInput(runtime, { text: '第一句。', messageSeq: 1 }, deps);
    for (let i = 2; i <= 4; i += 1) {
      ingestInput(runtime, { text: `第${i}句。`, messageSeq: i }, deps);
    }
    const summary = scanReviews(runtime, 4, deps);
    assert.equal(summary.shelvedCaptures >= 1, true);
    assert.equal(getCandidate(ctx.main, first.capture.id).status, 'shelved');
  });

  await t.test('promise extraction only reaches pending-due and is capped at 100', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    withImmediate(ctx.main, () => {
      for (let index = 0; index < 101; index += 1) {
        const observation = makeObservation(ctx, {
          messageSeq: 1000 + index,
          text: `承诺${index}`,
          origin: 'master@2026-11-03',
        });
        insertObservation(ctx.main, observation);
        const candidate = makeCandidate(ctx, observation, {
          businessKey: `due-cap:${index}`,
          type: 'promise',
          text: `承诺${index}`,
          why: '有期限',
        });
        insertCandidate(ctx.main, candidate);
        addCandidateEvidence(ctx, candidate, observation, `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}`);
        promoteInTransaction(ctx.main, { candidate, runtime, clock: ctx.clock });
      }
    });
    const pending = ctx.main.prepare("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'pending-due'").get().n;
    const shelved = ctx.main.prepare("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'shelved-due'").get().n;
    assert.equal(Number(pending), 100);
    assert.equal(Number(shelved), 1);
    const text = ctx.main
      .prepare("SELECT text FROM memories WHERE due_state = 'shelved-due'")
      .get().text;
    assert.match(text, /^承诺\d+$/);
  });

  await t.test('pending-due ages to shelved-due after 14 days and pauses on a backwards clock', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const deps = depsOf(ctx);
    const ingested = ingestInput(runtime, { text: '周五前交报告。', messageSeq: 1 }, deps);
    recordCandidates(
      runtime,
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '周五前交报告',
            why: '有期限',
            type: 'promise',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:21' }],
          },
        ],
      },
      deps,
    );
    const memory = ctx.main.prepare('SELECT * FROM memories LIMIT 1').get();
    assert.equal(memory.due_state, 'pending-due');

    const enqueuedAt = Date.parse(
      ctx.main.prepare('SELECT enqueued_at FROM due_queue WHERE memory_id = ?').get(memory.id).enqueued_at,
    );
    const clockPair = mutableClock();
    const movingDeps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    clockPair.set(new Date(enqueuedAt + 15 * DAY).toISOString());
    const aged = agePendingDue(ctx.main, { clock: clockPair.clock });
    assert.equal(aged.aged, 1);
    assert.equal(ctx.main.prepare('SELECT due_state FROM memories WHERE id = ?').get(memory.id).due_state, 'shelved-due');
    assert.equal(ctx.main.prepare('SELECT text FROM memories WHERE id = ?').get(memory.id).text, memory.text);

    // Backwards clock must not age anything further.
    clockPair.set('2026-11-03T00:00:00.000Z');
    const backwards = agePendingDue(ctx.main, { clock: clockPair.clock });
    assert.equal(backwards.aged, 0);
    assert.equal(backwards.skipped, 'clock_backwards');
    void movingDeps;
  });

  await t.test('a permission proposal stays pending and is deferred at deadline', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const proposal = proposeOwnerAction(
      runtime,
      { action: 'due-open', targetIds: ['mem_x'], payload: { text: 'x' }, baseVersions: [] },
      deps,
    );
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.executed, false);
    clockPair.advance(DAY + 1000);
    const summary = scanReviews(runtime, 0, deps);
    assert.equal(summary.deferred, 1);
    assert.equal(countRows(ctx.main, 'memories'), 0);
    const resume = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_kind = 'pending' AND status = 'closed'")
      .get();
    assert.equal(resume.close_reason, 'deferred');
  });

  await t.test('scene expansion proposals do not widen visibility silently', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '这条想两边都看。', messageSeq: 1 }, depsOf(ctx));
    const response = recordCandidates(
      runtime,
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '想两边都看',
            why: '跨场景',
            type: 'fact',
            scene: 'both',
            scope: 'global',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:21' }],
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(response.items[0].status, 'found');
    assert.equal(response.items[0].pendingId !== null, true);
    assert.equal(countRows(ctx.main, 'memories'), 0);
    const candidate = getCandidate(ctx.main, response.items[0].id);
    assert.equal(candidate.status, 'pending');
    assert.equal(candidate.scene, 'both');
    assert.equal(relationCount(ctx, 'pending'), 1);
  });
});

test('M2 tool handler boundaries', async (t) => {
  await t.test('reject only works on the model own untouched pending candidate', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const observation = makeObservation(ctx, { messageSeq: 500, text: '待拒绝' });
    insertObservation(ctx.main, observation);
    const candidate = makeCandidate(ctx, observation, { businessKey: 'reject-me:1', why: '测试' });
    insertCandidate(ctx.main, candidate);
    const other = fakeRuntime({ sessionId: 'other-session' });
    assert.throws(() => rejectCandidate(other, candidate.id, 'nope', depsOf(ctx)), /reject_outside_session/);
    ctx.main.prepare('UPDATE candidates SET owner_touched = 1 WHERE id = ?').run(candidate.id);
    assert.throws(() => rejectCandidate(runtime, candidate.id, 'nope', depsOf(ctx)), /reject_owner_touched/);
    ctx.main.prepare('UPDATE candidates SET owner_touched = 0 WHERE id = ?').run(candidate.id);
    const result = rejectCandidate(runtime, candidate.id, 'noise', depsOf(ctx));
    assert.equal(result.status, 'found');
    assert.equal(getCandidate(ctx.main, candidate.id).status, 'rejected');
    assert.equal(relationCount(ctx, 'reject'), 1);
  });

  await t.test('unsupported record kinds fail explicitly without writing', () => {
    const ctx = withContext(t);
    const handler = createRecordHandler(depsOf(ctx));
    const runtime = fakeRuntime();
    const before = counts(ctx);
    for (const kind of ['dream']) {
      const result = handler.record(runtime, { kind, items: [{ text: 'x' }] });
      assert.equal(result.status, 'error');
      assert.equal(result.code, 'unsupported_in_batch');
    }
    // Batch-2 enables self_note / judgment / speculation; a runtime without a
    // stable call id gets an honest identity error instead of "unsupported".
    for (const kind of ['self_note', 'judgment', 'speculation']) {
      const enabled = handler.record(runtime, { kind, items: [{ text: 'x', reason: 'y' }] });
      assert.equal(enabled.code, 'runtime_identity_unavailable', kind);
    }
    // project_update is enabled in the work window; an unknown project is a
    // validation error, not an unsupported batch feature.
    const project = handler.record(runtime, {
      kind: 'project_update',
      items: [{ projectId: 'proj_missing', baseRevision: 1, snapshot: { progress: 'x' } }],
    });
    assert.equal(project.items[0].error, 'project_missing');
    assert.deepEqual(counts(ctx), before);
  });

  await t.test('record handler drives the candidate path end to end', () => {
    const ctx = withContext(t);
    const handler = createRecordHandler(depsOf(ctx));
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '我不喜欢刺角瓜。', messageSeq: 1 }, depsOf(ctx));
    const result = handler.record(runtime, {
      kind: 'candidate',
      request_id: 'call-1',
      items: [
        {
          observationId: ingested.observation.id,
          text: '不喜欢刺角瓜',
          why: '选食材',
          type: 'preference',
          evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:3:21' }],
        },
      ],
    });
    assert.equal(result.items[0].status, 'found');
    assert.equal(countRows(ctx.main, 'memories'), 1);
  });

  await t.test('timeline ends ongoing only; pointer exact requires a location', () => {
    const ctx = withContext(t);
    const handler = createRecordHandler(depsOf(ctx));
    const runtime = fakeRuntime();
    const observation = makeObservation(ctx, { messageSeq: 600, text: '在学习' });
    insertObservation(ctx.main, observation);
    const candidate = makeCandidate(ctx, observation, {
      businessKey: 'timeline:1',
      timeState: 'ongoing',
      startAt: '2026-11-01T00:00:00.000Z',
      why: '持续',
    });
    insertCandidate(ctx.main, candidate);
    addCandidateEvidence(ctx, candidate, observation, 'bytes:0:9');
    const promoted = promoteInTransaction(ctx.main, { candidate, runtime, clock: ctx.clock });
    const timelineOk = handler.record(runtime, {
      kind: 'timeline_change',
      items: [{ targetId: promoted.memory.id, from: 'ongoing', to: 'ended_unknown' }],
    });
    assert.equal(timelineOk.items[0].status, 'found');
    const badPointer = handler.record(runtime, {
      kind: 'pointer_change',
      items: [{ targetId: promoted.memory.id, from: 'unknown', to: 'exact' }],
    });
    assert.equal(badPointer.items[0].error, 'validation_error');
    const goodPointer = handler.record(runtime, {
      kind: 'pointer_change',
      items: [
        {
          targetId: promoted.memory.id,
          from: 'unknown',
          to: 'exact',
          location: 'file:会话#2026-11-01',
        },
      ],
    });
    assert.equal(goodPointer.items[0].status, 'found');
    assert.equal(
      ctx.main.prepare('SELECT status FROM pointers WHERE memory_id = ?').get(promoted.memory.id).status,
      'exact',
    );
  });

  await t.test('observation survives a failed promotion through the tool handler', () => {
    const ctx = withContext(t);
    const runtime = fakeRuntime();
    const ingested = ingestInput(runtime, { text: '会被提升失败。', messageSeq: 1 }, depsOf(ctx));
    const failingDeps = {
      ...depsOf(ctx),
      faultInjector: {
        promoteHooks: {
          beforeStep(index) {
            if (index === 0) throw new Error('injected');
          },
        },
      },
    };
    const handler = createRecordHandler(failingDeps);
    const result = handler.record(runtime, {
      kind: 'candidate',
      items: [
        {
          observationId: ingested.observation.id,
          text: '会被提升失败',
          why: '测试',
          type: 'fact',
          evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:12' }],
        },
      ],
    });
    assert.equal(result.items[0].status, 'unknown');
    assert.equal(countRows(ctx.main, 'memories'), 0);
    const observation = getObservation(ctx.main, ingested.observation.id);
    assert.ok(observation);
    assert.equal(readExactObservation(ctx.main, observation).status, 'found');
  });
});
