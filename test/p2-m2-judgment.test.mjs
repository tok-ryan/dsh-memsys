import assert from 'node:assert/strict';
import test from 'node:test';

import { withImmediate } from '../src/storage/open.mjs';
import {
  appendRelation,
  insertCandidate,
  insertMemory,
  insertObservation,
} from '../src/storage/repositories.mjs';
import {
  recordJudgments,
  recordOutcomeChange,
  recordRegisteredToolOutcome,
  recordSpeculations,
  recordVerdict,
  readJudgmentState,
} from '../src/write/judgment.mjs';
import {
  ageJudgments,
  deferExpiredNeedsReview,
} from '../src/write/judgment-review.mjs';
import {
  applyMasterVerdict,
  issueReceipt,
  masterVerdictPayloadHash,
  verdictVoidPayloadHash,
  voidMasterVerdict,
} from '../src/write/owner-actions.mjs';
import { recordSelfNotes } from '../src/write/self-note.mjs';
import { recordCandidates } from '../src/write/candidate.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { selfGet } from '../src/read/self.mjs';
import { reviewGet } from '../src/read/review.mjs';
import { createReadHandler } from '../src/tools/read.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import {
  createTestContext,
  makeCandidate,
  makeMemory,
  makeObservation,
  mutableClock,
  registerEntity,
} from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

function rt(callId) {
  return fakeRuntime({ callId, requestId: callId });
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function makeJudgment(ctx, callId, overrides = {}) {
  const result = recordJudgments(
    rt(callId),
    {
      items: [
        {
          verdict_text: overrides.verdict_text ?? '先跑测试再提交',
          basis: overrides.basis ?? '上次跳测试出了事故',
          falsifier: overrides.falsifier ?? '出现反例：跳过测试也没出事',
          evidence_refs: overrides.evidence_refs ?? [],
          outcome: overrides.outcome ?? 'pending',
          proof_scope: overrides.proof_scope ?? null,
          topic_components: overrides.topic_components ?? null,
        },
      ],
    },
    depsOf(ctx),
  );
  return result.items[0];
}

function viewRow(ctx, judgmentId) {
  return ctx.main.prepare('SELECT * FROM judgment_current WHERE id = ?').get(judgmentId);
}


function judgmentBaseHash(ctx, judgmentId) {
  return ctx.main.prepare('SELECT payload_hash FROM judgments WHERE id = ?').get(judgmentId).payload_hash;
}

function issue(ctx, overrides = {}) {
  return withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner-1',
      proposalId: overrides.proposalId ?? `proposal-${(seq += 1)}`,
      action: overrides.action ?? 'master-verdict',
      payloadHash: overrides.payloadHash ?? `hash-${seq}`,
      targetIds: overrides.targetIds ?? [],
      baseVersions: overrides.baseVersions ?? [],
      nonce: overrides.nonce ?? `nonce-${seq}`,
      inputEventId: overrides.inputEventId ?? `evt-${seq}`,
    }),
  );
}

test('P2-M2 judgment rows and two separate columns', async (t) => {
  await t.test('judgment rows are append-only and must point at a model observation', () => {
    const ctx = withContext(t);
    const created = makeJudgment(ctx, 'call-j1');
    assert.equal(created.status, 'found');
    assert.throws(
      () => ctx.main.prepare('UPDATE judgments SET verdict_text = ? WHERE id = ?').run('x', created.id),
      /judgments_append_only/,
    );
    assert.throws(
      () => ctx.main.prepare('DELETE FROM judgments WHERE id = ?').run(created.id),
      /judgments_append_only/,
    );

    const observation = makeObservation(ctx, { messageSeq: 7001, text: '主人原话' });
    insertObservation(ctx.main, observation);
    assert.throws(
      () =>
        ctx.main
          .prepare(
            `INSERT INTO judgments
               (id, idempotency_key, at, payload_hash, observation_id, verdict_text, basis,
                falsifier, evidence_refs, evidence_origin, key_status, binding_status, outcome,
                origin, state_snapshot, initial_strength)
             VALUES ('jdg_raw', 'raw', ?, 'h', ?, 'x', 'y', 'z', '[]', '[]', 'unresolved',
                     'proposed', 'pending', 'model:x', '{}', 0.5)`,
          )
          .run(ctx.clock.at().at, observation.id),
      /judgment_observation_not_model/,
    );
  });

  await t.test('outcome and verdict are independent columns, not one pending flag', () => {
    const ctx = withContext(t);
    const created = makeJudgment(ctx, 'call-j2');
    const verdict = recordVerdict(rt('call-v2'), { items: [{ judgmentId: created.id, by: 'self', result: 'wrong', basis: 'b' }] }, depsOf(ctx));
    assert.equal(verdict.items[0].status, 'found');
    const before = viewRow(ctx, created.id);
    assert.equal(before.outcome, 'pending');
    assert.equal(before.verdict_result, 'wrong');

    const done = recordOutcomeChange(
      rt('call-o2'),
      {
        items: [
          {
            judgmentId: created.id,
            baseRevision: 0,
            from: 'pending',
            to: 'done',
            why: '命令执行成功',
            proof_scope: { kind: 'command', operationId: 'op-1', resultRef: 'obs_x', resultHash: 'h' },
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(done.items[0].status, 'found');
    const after = viewRow(ctx, created.id);
    assert.equal(after.outcome, 'done');
    assert.equal(after.verdict_result, 'wrong', 'done must not turn the verdict right');
    assert.equal(after.outcome_revision, 1);
    const raw = ctx.main.prepare('SELECT outcome FROM judgments WHERE id = ?').get(created.id);
    assert.equal(raw.outcome, 'pending', 'original outcome column stays immutable');
  });

  await t.test('done requires a proof object; invalid and same-state changes are refused', () => {
    const ctx = withContext(t);
    const created = makeJudgment(ctx, 'call-j3');
    const deps = depsOf(ctx);
    const noProof = recordOutcomeChange(
      rt('call-o3'),
      { items: [{ judgmentId: created.id, baseRevision: 0, from: 'pending', to: 'done', why: 'x' }] },
      deps,
    );
    assert.equal(noProof.items[0].error, 'validation_error');
    const same = recordOutcomeChange(
      rt('call-o3b'),
      { items: [{ judgmentId: created.id, baseRevision: 0, from: 'pending', to: 'pending', why: 'x' }] },
      deps,
    );
    assert.equal(same.items[0].error, 'no_state_change');
    const stale = recordOutcomeChange(
      rt('call-o3c'),
      { items: [{ judgmentId: created.id, baseRevision: 7, from: 'pending', to: 'failed', why: 'x' }] },
      deps,
    );
    assert.equal(stale.items[0].error, 'stale_outcome');
  });

  await t.test('reverted keeps a trace and refuses stale late results', () => {
    const ctx = withContext(t);
    const created = makeJudgment(ctx, 'call-j4');
    const deps = depsOf(ctx);
    const done = recordOutcomeChange(
      rt('call-o4'),
      {
        items: [
          {
            judgmentId: created.id,
            baseRevision: 0,
            from: 'pending',
            to: 'done',
            why: 'first run ok',
            proof_scope: { kind: 'command', operationId: 'op-4', resultRef: 'obs_4', resultHash: 'h4' },
          },
        ],
      },
      deps,
    );
    assert.equal(done.items[0].status, 'found');
    const reverted = recordOutcomeChange(
      rt('call-o4b'),
      { items: [{ judgmentId: created.id, baseRevision: 1, from: 'done', to: 'reverted', why: '回滚了' }] },
      deps,
    );
    assert.equal(reverted.items[0].status, 'found');
    const late = recordOutcomeChange(
      rt('call-o4c'),
      { items: [{ judgmentId: created.id, baseRevision: 1, from: 'done', to: 'reverted', why: '迟到的旧结果' }] },
      deps,
    );
    assert.equal(late.items[0].error, 'stale_outcome');
    const events = ctx.main
      .prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'outcome-change'")
      .get();
    assert.equal(Number(events.n), 2);
    const replay = recordOutcomeChange(
      rt('call-o4b'),
      { items: [{ judgmentId: created.id, baseRevision: 1, from: 'done', to: 'reverted', why: '回滚了' }] },
      deps,
    );
    assert.equal(replay.items[0].replayed, true);
    assert.equal(Number(ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'outcome-change'").get().n), 2);
  });

  await t.test('registered tool results set outcome but never a verdict', () => {
    const ctx = withContext(t);
    const ok = makeJudgment(ctx, 'call-j5');
    const okResult = recordRegisteredToolOutcome(
      { operationId: 'op-5', judgmentId: ok.id, exitCode: 0, resultRef: 'obs_5', resultHash: 'h5' },
      { ...depsOf(ctx), runtime: rt('wrapper-5') },
    );
    assert.equal(okResult.items[0].status, 'found');
    const okView = viewRow(ctx, ok.id);
    assert.equal(okView.outcome, 'done');
    assert.equal(okView.verdict_result, null);

    const bad = makeJudgment(ctx, 'call-j6');
    const badResult = recordRegisteredToolOutcome(
      { operationId: 'op-6', judgmentId: bad.id, exitCode: 3, resultRef: 'obs_6', resultHash: 'h6' },
      { ...depsOf(ctx), runtime: rt('wrapper-6') },
    );
    assert.equal(badResult.items[0].status, 'found');
    assert.equal(viewRow(ctx, bad.id).outcome, 'failed');
  });
});

test('P2-M2 verdicts, master receipts and review', async (t) => {
  await t.test('self cannot be right; auto may be right; master overrides', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = makeJudgment(ctx, 'call-j7');
    const selfRight = recordVerdict(rt('call-v7'), { items: [{ judgmentId: created.id, by: 'self', result: 'right', basis: 'b' }] }, deps);
    assert.equal(selfRight.items[0].error, 'validation_error');
    const autoRight = recordVerdict(rt('call-v7b'), { items: [{ judgmentId: created.id, by: 'auto', result: 'right', basis: 'b' }] }, deps);
    assert.equal(autoRight.items[0].status, 'found');

    const receipt = issue(ctx, {
      action: 'master-verdict',
      targetIds: [created.id],
      baseVersions: [judgmentBaseHash(ctx, created.id)],
      payloadHash: masterVerdictPayloadHash({ judgmentId: created.id, result: 'wrong', basis: '主人判断' }),
    });
    const master = applyMasterVerdict(ctx.main, ctx.clock, {
      receiptId: receipt.receiptId,
      judgmentId: created.id,
      result: 'wrong',
      basis: '主人判断',
    });
    assert.equal(master.ok, true);
    const view = viewRow(ctx, created.id);
    assert.equal(view.verdict_result, 'wrong');

    const selfAfterMaster = recordVerdict(rt('call-v7c'), { items: [{ judgmentId: created.id, by: 'self', result: 'pending', basis: 'b' }] }, deps);
    assert.equal(selfAfterMaster.items[0].error, 'invalid_transition');
  });

  await t.test('owner void falls back to the earlier verdict without deleting it', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = makeJudgment(ctx, 'call-j8');
    recordVerdict(rt('call-v8'), { items: [{ judgmentId: created.id, by: 'self', result: 'wrong', basis: 'b' }] }, deps);
    const receipt = issue(ctx, {
      action: 'master-verdict',
      targetIds: [created.id],
      baseVersions: [judgmentBaseHash(ctx, created.id)],
      payloadHash: masterVerdictPayloadHash({ judgmentId: created.id, result: 'right', basis: '主人判断' }),
    });
    const master = applyMasterVerdict(ctx.main, ctx.clock, {
      receiptId: receipt.receiptId,
      judgmentId: created.id,
      result: 'right',
      basis: '主人判断',
    });
    assert.equal(master.ok, true);
    const voidReceipt = issue(ctx, {
      action: 'verdict-void',
      targetIds: [created.id, master.verdictId],
      baseVersions: [judgmentBaseHash(ctx, created.id), master.verdictId],
      payloadHash: verdictVoidPayloadHash({ judgmentId: created.id, verdictId: master.verdictId, reason: '主人撤回' }),
    });
    const voided = voidMasterVerdict(ctx.main, ctx.clock, {
      receiptId: voidReceipt.receiptId,
      judgmentId: created.id,
      verdictId: master.verdictId,
      reason: '主人撤回',
    });
    assert.equal(voided.ok, true);
    assert.equal(viewRow(ctx, created.id).verdict_result, 'wrong', 'falls back to the self verdict');
    const verdictRows = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'verdict'").get();
    assert.equal(Number(verdictRows.n), 2, 'both verdict rows are kept');
  });

  await t.test('reflection creates needs-review without changing verdict or outcome', () => {
    const ctx = withContext(t);
    const judgment = makeJudgment(ctx, 'call-j9');
    const note = recordSelfNotes(
      rt('call-note9'),
      { items: [{ text: '我在那条判断上想多了', reason: '反思', reflection_judgment_ids: [judgment.id] }] },
      depsOf(ctx),
    );
    assert.equal(note.items[0].status, 'found');
    const queue = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_kind = 'needs-review' AND status = 'open'")
      .get();
    assert.ok(queue, 'needs-review queue row exists');
    const state = readJudgmentState(ctx.main, judgment.id);
    assert.equal(state.needsReview, true);
    assert.equal(viewRow(ctx, judgment.id).outcome, 'pending');
    assert.equal(viewRow(ctx, judgment.id).verdict_result, null);
    const bad = recordSelfNotes(
      rt('call-note9b'),
      { items: [{ text: 'x', reason: 'y', reflection_judgment_ids: ['jdg_missing'] }] },
      depsOf(ctx),
    );
    assert.equal(bad.items[0].error, 'validation_error');
  });

  await t.test('a resolved judge topic collision opens a needs-review item', () => {
    const ctx = withContext(t);
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    const components = { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: 'entity:ingredient:scallion' };
    makeJudgment(ctx, 'call-j10', {
      topic_components: components,
      verdict_text: '葱可以吃',
    });
    const ingested = recordSelfNotes === null ? null : null;
    void ingested;
    const observation = makeObservation(ctx, { messageSeq: 7002, text: '我喜欢葱。' });
    insertObservation(ctx.main, observation);
    const candidate = recordCandidates(
      rt('call-c10'),
      {
        items: [
          {
            observationId: observation.id,
            text: '喜欢葱',
            why: '口味',
            type: 'preference',
            evidenceRefs: [{ observationId: observation.id, sourceSpan: 'bytes:3:6' }],
            topicComponents: components,
          },
        ],
      },
      depsOf(ctx),
    );
    assert.equal(candidate.items[0].status, 'found');
    const collision = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_kind = 'needs-review' AND object_id = ?")
      .all(
        ctx.main.prepare("SELECT id FROM judgments WHERE verdict_text = '葱可以吃'").get().id,
      );
    assert.equal(collision.length, 1);
  });
});

test('P2-M2 aging and default exits', async (t) => {
  await t.test('no verdict ages to auto/unverified once; before threshold nothing happens', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const created = recordJudgments(rt('call-age1'), { items: [{ verdict_text: '会老化', basis: 'b', falsifier: 'f' }] }, deps).items[0];
    clockPair.advance(29 * DAY);
    assert.equal(ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 }).autoAging, 0);
    clockPair.advance(2 * DAY);
    const first = ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    assert.equal(first.autoAging, 1);
    const again = ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    assert.equal(again.autoAging, 0, 'repeated scans do not duplicate the verdict');
    const view = viewRow(ctx, created.id);
    assert.equal(view.outcome, 'pending');
    assert.equal(view.verdict_result, 'unverified');
  });

  await t.test('a self-only verdict ages into needs-review; a master verdict is untouched', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const selfJudgment = recordJudgments(rt('call-age2'), { items: [{ verdict_text: '自卫', basis: 'b', falsifier: 'f' }] }, deps).items[0];
    recordVerdict(rt('call-age2v'), { items: [{ judgmentId: selfJudgment.id, by: 'self', result: 'wrong', basis: 'b' }] }, deps);
    const masterJudgment = recordJudgments(rt('call-age3'), { items: [{ verdict_text: '主人定的', basis: 'b', falsifier: 'f' }] }, deps).items[0];
    const receipt = issue(ctx, {
      action: 'master-verdict',
      targetIds: [masterJudgment.id],
      baseVersions: [judgmentBaseHash(ctx, masterJudgment.id)],
      payloadHash: masterVerdictPayloadHash({ judgmentId: masterJudgment.id, result: 'right', basis: '主人判断' }),
    });
    applyMasterVerdict(ctx.main, ctx.clock, {
      receiptId: receipt.receiptId,
      judgmentId: masterJudgment.id,
      result: 'right',
      basis: '主人判断',
    });

    clockPair.advance(31 * DAY);
    const aged = ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    assert.equal(aged.needsReview, 1);
    assert.equal(aged.autoAging, 0);
    const review = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_kind = 'needs-review' AND object_id = ?")
      .all(selfJudgment.id);
    assert.equal(review.length, 1);
    assert.equal(viewRow(ctx, masterJudgment.id).verdict_result, 'right');
    assert.equal(
      ctx.main.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE object_id = ?").get(masterJudgment.id).n,
      0,
    );
  });

  await t.test('a backwards clock pauses aging instead of firing early', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    recordJudgments(rt('call-age4'), { items: [{ verdict_text: '回拨', basis: 'b', falsifier: 'f' }] }, deps);
    clockPair.advance(40 * DAY);
    clockPair.set('2026-11-02T00:00:00.000Z');
    const result = ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    assert.equal(result.skipped, 'clock_backwards');
    assert.equal(result.autoAging, 0);
  });

  await t.test('expired needs-review defers without changing the verdict', () => {
    const ctx = withContext(t);
    const clockPair = mutableClock();
    const deps = { main: ctx.main, control: ctx.control, clock: clockPair.clock };
    const judgment = recordJudgments(rt('call-def'), { items: [{ verdict_text: '待复核', basis: 'b', falsifier: 'f' }] }, deps).items[0];
    recordSelfNotes(
      rt('call-def-note'),
      { items: [{ text: '想想', reason: '反思', reflection_judgment_ids: [judgment.id] }] },
      deps,
    );
    clockPair.advance(2 * DAY);
    const deferred = deferExpiredNeedsReview(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    assert.equal(deferred.deferred, 1);
    const queue = ctx.main
      .prepare("SELECT * FROM review_queue WHERE object_id = ? AND object_kind = 'needs-review'")
      .get(judgment.id);
    assert.equal(queue.status, 'closed');
    assert.equal(queue.close_reason, 'review-defer');
    const state = readJudgmentState(ctx.main, judgment.id);
    assert.equal(state.unreviewed, true);
    assert.equal(state.needsReview, false);
    assert.equal(viewRow(ctx, judgment.id).verdict_result, null);
  });
});

test('P2-M2 isolation, reads and handler routing', async (t) => {
  await t.test('speculations and judgments never enter automatic injection', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const before = compileRound({ ...deps, mode: 'work', roundId: 'p2m2-before', tokenizer: conservativeTokens, H: 20000 });
    recordJudgments(rt('call-iso1'), { items: [{ verdict_text: '不该出现在注入里', basis: 'b', falsifier: 'f' }] }, deps);
    recordSpeculations(
      rt('call-iso2'),
      { items: [{ text: '一个很远的猜测', basis: '第一步…第二步…', falsifier: '出现反例', basis_refs: [] }] },
      deps,
    );
    const after = compileRound({ ...deps, mode: 'work', roundId: 'p2m2-after', tokenizer: conservativeTokens, H: 20000 });
    assert.deepEqual(after.snapshot.eligible_ids, before.snapshot.eligible_ids);
    assert.equal(after.section.text.includes('不该出现在注入里'), false);
    assert.equal(after.section.text.includes('一个很远的猜测'), false);
  });

  await t.test('self_get reads judgments with split outcome/verdict and speculations verbatim', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const judgment = makeJudgment(ctx, 'call-read1');
    recordVerdict(rt('call-read1v'), { items: [{ judgmentId: judgment.id, by: 'self', result: 'wrong', basis: 'b' }] }, deps);
    const readJudgment = selfGet({ main: ctx.main, clock: ctx.clock, kind: 'judgment', ids: [judgment.id] });
    assert.equal(readJudgment.status, 'ok');
    assert.equal(readJudgment.items[0].outcome, 'pending');
    assert.equal(readJudgment.items[0].verdict.result, 'wrong');
    const speculation = recordSpeculations(
      rt('call-read2'),
      { items: [{ text: '猜一个', basis: '链', falsifier: '反例', basis_refs: [] }] },
      deps,
    ).items[0];
    const readSpeculation = selfGet({ main: ctx.main, clock: ctx.clock, kind: 'speculation', ids: [speculation.id] });
    assert.equal(readSpeculation.items[0].text, '猜一个');
  });

  await t.test('review_get lists needs-review items and record handler routes B2 kinds', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const judgment = makeJudgment(ctx, 'call-rev1');
    recordSelfNotes(
      rt('call-rev1n'),
      { items: [{ text: '反思', reason: 'r', reflection_judgment_ids: [judgment.id] }] },
      deps,
    );
    const page = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'needs-review' });
    assert.equal(page.status, 'ok');
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].object_id, judgment.id);

    const handler = createRecordHandler(deps);
    const routed = handler.record(rt('call-handler2'), {
      kind: 'judgment',
      items: [{ verdict_text: '通过 handler 写判断', basis: 'b', falsifier: 'f' }],
    });
    assert.equal(routed.items[0].status, 'found');
    const registered = handler.record(rt('call-handler3'), {
      kind: 'registered_tool_outcome',
      items: [{ judgmentId: judgment.id }],
    });
    assert.equal(registered.code, 'unsupported_in_batch');
  });

  await t.test('candidates may reference an existing judgment but not a fake one', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const judgment = makeJudgment(ctx, 'call-ref1');
    const observation = makeObservation(ctx, { messageSeq: 7003, text: '关联判断的观察' });
    insertObservation(ctx.main, observation);
    const good = recordCandidates(
      rt('call-ref2'),
      {
        items: [
          {
            observationId: observation.id,
            text: '有判断依据的候选',
            why: '第二档',
            type: 'fact',
            judgmentId: judgment.id,
            evidenceRefs: [{ observationId: observation.id, sourceSpan: 'bytes:0:6' }],
          },
        ],
      },
      deps,
    );
    assert.equal(good.items[0].status, 'found');
    const bad = recordCandidates(
      rt('call-ref3'),
      {
        items: [
          {
            observationId: observation.id,
            text: '引用了不存在的判断',
            why: 'x',
            type: 'fact',
            judgmentId: 'jdg_missing',
            evidenceRefs: [{ observationId: observation.id, sourceSpan: 'bytes:0:6' }],
          },
        ],
      },
      deps,
    );
    assert.equal(bad.items[0].error, 'validation_error');
  });

  await t.test('marker', (t2) => {
    const ctx = withContext(t2);
    const deps = depsOf(ctx);
    const judgment = makeJudgment(ctx, 'call-marker');
    recordOutcomeChange(
      rt('call-marker-o'),
      {
        items: [
          {
            judgmentId: judgment.id,
            baseRevision: 0,
            from: 'pending',
            to: 'done',
            why: 'ok',
            proof_scope: { kind: 'command', operationId: 'op-m', resultRef: 'obs_m', resultHash: 'hm' },
          },
        ],
      },
      deps,
    );
    recordVerdict(rt('call-marker-v'), { items: [{ judgmentId: judgment.id, by: 'self', result: 'pending', basis: 'b' }] }, deps);
    const view = viewRow(ctx, judgment.id);
    const outcomeSeparate = view.outcome === 'done' && view.verdict_result === 'pending' && view.verdict_id !== null;
    const before = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'verdict'").get();
    const clockPair = mutableClock();
    clockPair.advance(31 * DAY);
    ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    const firstCount = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'verdict'").get();
    ageJudgments(ctx.main, { clock: clockPair.clock, inputSeq: 0 });
    const secondCount = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'verdict'").get();
    const agingReplay = Number(secondCount.n) === Number(firstCount.n);
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'p2m2-marker', tokenizer: conservativeTokens, H: 20000 });
    const speculationInS = compiled.snapshot.eligible_ids.some((id) => id.startsWith('spec_'));
    assert.equal(outcomeSeparate, true);
    assert.equal(agingReplay, true);
    assert.equal(speculationInS, false);
    assert.ok(Number(firstCount.n) >= Number(before.n));
    t2.diagnostic(`P2_M2_OK outcome_separate=${outcomeSeparate} aging_replay=${agingReplay} speculation_in_S=${speculationInS}`);
  });
});
