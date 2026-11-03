import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { withImmediate } from '../src/storage/open.mjs';
import {
  countRows,
  getMemory,
  getObservation,
  insertObservation,
  insertCandidate,
  insertMemory,
  insertPointer,
  insertTimeline,
  putState,
} from '../src/storage/repositories.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { confirmationState, dreamStatus } from '../src/dream/replay.mjs';
import { confirmDream, unconfirmDream, voidDream, dreamConfirmPayloadHash, unconfirmDreamPayloadHash, voidDreamPayloadHash } from '../src/dream/confirm.mjs';
import { createDreamHandler } from '../src/tools/dream.mjs';
import { dreamGet, dreamReviewList } from '../src/read/dream.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { createReadHandler } from '../src/tools/read.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seq = 0;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
}

function dreamRuntime(callId) {
  return fakeRuntime({ role: 'dream', callId, requestId: callId });
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function receipt(ctx, { action, targetIds = [], payloadHash = null, proposalId = null, baseVersions = [] }) {
  seq += 1;
  return withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner',
      proposalId: proposalId ?? `p3-${seq}`,
      action,
      payloadHash: payloadHash ?? `h-${seq}`,
      targetIds,
      baseVersions,
      nonce: `n-${seq}`,
      inputEventId: `e-${seq}`,
    }),
  ).receiptId;
}


let ownerSeq = 0;
function ownerObservation(ctx) {
  ownerSeq += 1;
  const observation = makeObservation(ctx, { messageSeq: 9500 + ownerSeq, text: '主人批准这个梦' });
  insertObservation(ctx.main, observation);
  return observation.id;
}

const registeredContexts = new WeakSet();
function components() {
  if (!registeredContexts.has(currentCtx)) {
    registerEntity(currentCtx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    registeredContexts.add(currentCtx);
  }
  return { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' };
}
let currentCtx = null;

function draftFor(text) {
  return {
    text,
    detail: null,
    why: '梦后形成的判断',
    type: 'fact',
    scene: 'work',
    scope: 'work-only',
    components: components(),
  };
}

test('P3-C1 dream library and confirmation chain', async (t) => {
  await t.test('dream role is required and linkedIds are verified', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    assert.throws(
      () => recordDream(deps, { runtime: fakeRuntime({ callId: 'owner-dream' }), item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'p' }] } }),
      (err) => err.code === 'forbidden_role',
    );
    assert.throws(
      () =>
        recordDream(deps, {
          runtime: dreamRuntime('d-link'),
          item: { linkedIds: ['mem_missing'], basis: 'b', idea: 'i', propositions: [{ text: 'p' }] },
        }),
      (err) => err.code === 'validation_error',
    );
  });

  await t.test('one dream transaction writes dream, propositions and inferred candidates', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const result = recordDream(deps, {
      runtime: dreamRuntime('d-1'),
      item: { linkedIds: [], basis: '白天想到的', idea: '一个梦', propositions: [{ text: '梦命题一' }, { text: '梦命题二' }] },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM dreams').get().n, 1);
    assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM propositions').get().n, 2);
    assert.equal(ctx.dream.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'inferred'").get().n, 2);
    assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'model'").get().n, 1);
    const replay = recordDream(deps, {
      runtime: dreamRuntime('d-1'),
      item: { linkedIds: [], basis: '白天想到的', idea: '一个梦', propositions: [{ text: '梦命题一' }, { text: '梦命题二' }] },
    });
    assert.equal(replay.replayed, true);
    const conflict = recordDream(deps, {
      runtime: dreamRuntime('d-1'),
      item: { linkedIds: [], basis: '白天想到的', idea: '改了主意', propositions: [{ text: '梦命题一' }, { text: '梦命题二' }] },
    });
    assert.equal(conflict.code, 'idempotency_conflict');
  });

  await t.test('inferred dreams never enter the fact set', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    recordDream(deps, { runtime: dreamRuntime('d-2'), item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '未确认的梦命题' }] } });
    assert.equal(countRows(ctx.main, 'memories'), 0);
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'c1-inferred', tokenizer: conservativeTokens, H: 20000 });
    assert.equal(compiled.eligible_ids.length, 0);
    assert.equal(compiled.section.text.includes('未确认的梦命题'), false);
  });

  await t.test('owner confirmation writes snapshot, proposition observation, candidate and memory', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const dreamResult = recordDream(deps, {
      runtime: dreamRuntime('d-3'),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '刺角瓜其实可以吃' }] },
    });
    const propositionId = dreamResult.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const confirmDraft = draftFor('刺角瓜其实可以吃');
    const ownerId = ownerObservation(ctx);
    const receiptId = receipt(ctx, {
      action: 'confirm-dream',
      targetIds: [dreamResult.dreamId],
      baseVersions: [textHash],
      payloadHash: dreamConfirmPayloadHash({
        dreamId: dreamResult.dreamId,
        propositionId,
        textHash,
        candidateDraft: confirmDraft,
        evidenceRefs: [],
        path: 'owner_assertion',
        ownerObservationId: ownerId,
      }),
    });
    const confirmed = confirmDream(deps, {
      receiptId,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: confirmDraft,
      path: 'owner_assertion',
      ownerObservationId: ownerId,
    });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));

    const snapshot = ctx.dream.prepare('SELECT * FROM confirmation_snapshots WHERE confirm_id = ?').get(confirmed.confirmId);
    assert.ok(snapshot);
    const payload = JSON.parse(snapshot.payload);
    assert.equal(payload.candidateDraft.bindingStatus, 'accepted');
    assert.equal(payload.candidateDraft.originMode, 'inherited');
    assert.ok(payload.deferred_generated.includes('memory.recorded_at'));

    const observation = ctx.main
      .prepare("SELECT * FROM observations WHERE source = 'dream'")
      .get();
    assert.ok(observation);
    assert.equal(observation.text, '刺角瓜其实可以吃');
    assert.match(observation.origin, /d-.*#p1/);
    const memory = getMemory(ctx.main, confirmed.memoryId);
    assert.ok(memory);
    assert.equal(memory.binding_status, 'accepted');
    assert.equal(memory.origin_mode, 'inherited');
    assert.equal(memory.key_status, 'resolved');

    const state = confirmationState(ctx.dream);
    assert.equal(state.get(propositionId).valid, true);
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'c1-confirmed', tokenizer: conservativeTokens, H: 20000 });
    assert.ok(compiled.eligible_ids.includes(memory.id));
  });

  await t.test('hash mismatch and unresolved topics are refused before any write', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const dreamResult = recordDream(deps, {
      runtime: dreamRuntime('d-4'),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '一个命题' }] },
    });
    const propositionId = dreamResult.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const badHashReceipt = receipt(ctx, {
      action: 'confirm-dream',
      targetIds: [dreamResult.dreamId],
      payloadHash: '0'.repeat(32),
    });
    const badHash = confirmDream(deps, {
      receiptId: badHashReceipt,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: draftFor('一个命题'),
    });
    assert.equal(badHash.code, 'receipt_hash_mismatch');


    const draft = draftFor('一个命题');
    draft.components = { entityRef: '刺角瓜', attributeRef: 'food_preference', objectRef: null };
    const unresolvedOwner = ownerObservation(ctx);
    const unresolvedReceipt = receipt(ctx, {
      action: 'confirm-dream',
      targetIds: [dreamResult.dreamId],
      baseVersions: [textHash],
      payloadHash: dreamConfirmPayloadHash({
        dreamId: dreamResult.dreamId,
        propositionId,
        textHash,
        candidateDraft: draft,
        evidenceRefs: [],
        path: 'owner_assertion',
        ownerObservationId: unresolvedOwner,
      }),
    });
    const unresolved = confirmDream(deps, {
      receiptId: unresolvedReceipt,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: draft,
      ownerObservationId: unresolvedOwner,
    });
    assert.equal(unresolved.code, 'unresolved_forbidden');
    assert.equal(countRows(ctx.main, 'memories'), 0);
  });

  await t.test('unconfirm and void remove the confirmed fact from S but keep the text', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const dreamResult = recordDream(deps, {
      runtime: dreamRuntime('d-5'),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '会被撤销的命题' }] },
    });
    const propositionId = dreamResult.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const revokedDraft = draftFor('会被撤销的命题');
    const revokedOwner = ownerObservation(ctx);
    const confirmReceipt = receipt(ctx, {
      action: 'confirm-dream',
      targetIds: [dreamResult.dreamId],
      baseVersions: [textHash],
      payloadHash: dreamConfirmPayloadHash({
        dreamId: dreamResult.dreamId,
        propositionId,
        textHash,
        candidateDraft: revokedDraft,
        evidenceRefs: [],
        path: 'owner_assertion',
        ownerObservationId: revokedOwner,
      }),
    });
    const confirmed = confirmDream(deps, {
      receiptId: confirmReceipt,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: revokedDraft,
      ownerObservationId: revokedOwner,
    });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    const unconfirmReceipt = receipt(ctx, {
      action: 'unconfirm-dream',
      targetIds: [confirmed.confirmId],
      baseVersions: [confirmed.confirmId],
      payloadHash: unconfirmDreamPayloadHash({
        confirmId: confirmed.confirmId,
        memoryId: confirmed.memoryId,
        propositionId,
        dreamId: dreamResult.dreamId,
      }),
    });
    const revoked = unconfirmDream(deps, {
      receiptId: unconfirmReceipt,
      confirmId: confirmed.confirmId,
      memoryId: confirmed.memoryId,
      propositionId,
      dreamId: dreamResult.dreamId,
    });
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
    assert.equal(confirmationState(ctx.dream).get(propositionId).valid, false);
    const memory = getMemory(ctx.main, confirmed.memoryId);
    assert.equal(memory.text, '会被撤销的命题');
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'c1-revoked', tokenizer: conservativeTokens, H: 20000 });
    assert.equal(compiled.eligible_ids.includes(confirmed.memoryId), false);

    const voidReceipt = receipt(ctx, {
      action: 'void-dream',
      targetIds: [dreamResult.dreamId],
      baseVersions: [dreamResult.dreamId],
      payloadHash: voidDreamPayloadHash({ dreamId: dreamResult.dreamId }),
    });
    const voided = voidDream(deps, { receiptId: voidReceipt, dreamId: dreamResult.dreamId, memoryIds: [confirmed.memoryId] });
    assert.equal(voided.ok, true);
    assert.equal(dreamStatus(ctx.dream, dreamResult.dreamId).voided, true);
  });

  await t.test('dream rows are append-only and reads stay off the main library', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const result = recordDream(deps, { runtime: dreamRuntime('d-6'), item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '只读' }] } });
    assert.throws(
      () => ctx.dream.prepare('UPDATE dreams SET idea = ? WHERE id = ?').run('x', result.dreamId),
      /dreams_append_only/,
    );
    assert.throws(
      () => ctx.dream.prepare('DELETE FROM propositions WHERE dream_id = ?').run(result.dreamId),
      /propositions_append_only/,
    );
    const handler = createDreamHandler(deps);
    const read = handler.get({ dreamId: result.dreamId });
    assert.equal(read.status, 'ok');
    assert.equal(read.propositions.length, 1);
    assert.equal(dreamReviewList({ dream: ctx.dream, clock: ctx.clock }).items.length, 1);
    assert.equal(dreamGet({ dream: ctx.dream, clock: ctx.clock, dreamId: result.dreamId }).status, 'ok');
  });
});


function makeActiveMemory(ctx, overrides = {}) {
  seq += 1;
  const textValue = overrides.text ?? '统一文本';
  const observation = makeObservation(ctx, { messageSeq: 9700 + seq, text: textValue });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, {
    businessKey: `p3-mem-${seq}`,
    text: textValue,
    why: overrides.why ?? '固定理由',
    type: 'fact',
    scene: 'work',
    scope: 'work-only',
  });
  Object.assign(candidate, {
    key_status: 'resolved',
    binding_status: 'accepted',
    binding_basis: JSON.stringify({ ruleRevision: 'topic-v1', source: 'test' }),
    origin_mode: 'self',
    semantic_status: 'quoted',
    record_kind: 'utterance',
    origin: overrides.origin ?? candidate.origin,
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, {
    key_status: 'resolved',
    binding_status: 'accepted',
    binding_basis: candidate.binding_basis,
    origin_mode: 'self',
  });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  return memory;
}

test('P3-C1 dream surface, public read and organize', async (t) => {
  await t.test('surface needs the switch, R>=0.45 and consumes frequency once per session/day', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const memory = makeActiveMemory(ctx, { text: '最近一直在弄项目' });
    const dreamResult = recordDream(deps, {
      runtime: dreamRuntime('surface-dream'),
      item: { linkedIds: [memory.id], basis: '项目', idea: '梦到上线', propositions: [{ text: '项目会顺利上线' }] },
    });
    const disabled = compileRound({ ...deps, mode: 'work', roundId: 'surface-off', tokenizer: conservativeTokens, H: 20000, sessionId: 's1' });
    assert.equal(disabled.section.text.includes('[未验证的梦]'), false);

    putState(ctx.main, 'dream-surface:enabled', { enabled: true }, 1);
    const typed = `dream:${dreamResult.propositionIds[0]}`;
    const first = compileRound({ ...deps, mode: 'work', roundId: 'surface-1', tokenizer: conservativeTokens, H: 20000, sessionId: 's1' });
    assert.ok(first.section.text.includes('[未验证的梦]'));
    assert.ok(first.section.text.includes(typed));
    assert.ok(first.eligible_ids.includes(typed));
    const second = compileRound({ ...deps, mode: 'work', roundId: 'surface-2', tokenizer: conservativeTokens, H: 20000, sessionId: 's1' });
    assert.equal(second.eligible_ids.includes(typed), false);
    const otherSession = compileRound({ ...deps, mode: 'work', roundId: 'surface-3', tokenizer: conservativeTokens, H: 20000, sessionId: 's2' });
    assert.ok(otherSession.eligible_ids.includes(typed));
  });

  await t.test('review_get kind=dream and dream page read original text', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const result = recordDream(deps, {
      runtime: dreamRuntime('read-dream'),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '公开可读的梦' }] },
    });
    const handler = createReadHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock, dream: ctx.dream });
    const review = handler.review({ kind: 'dream' });
    assert.equal(review.status, 'ok');
    assert.equal(review.items.length, 1);
    const page = handler.dreamPage({ dreamId: result.dreamId });
    assert.equal(page.status, 'ok');
    assert.equal(page.propositions[0].text, '公开可读的梦');
    assert.equal(handler.review({ kind: 'dream' }).items[0].propositions[0].confirmed, false);
  });

  await t.test('merge_exact merges only identical endpoints and supersedes old rows', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const a = makeActiveMemory(ctx, { text: '完全相同的记忆' });
    const b = makeActiveMemory(ctx, { text: '完全相同的记忆' });
    const handler = createDreamHandler(deps);
    const merged = handler.organize(dreamRuntime('org-merge'), { action: 'merge_exact', ids: [a.id, b.id] });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n, 3);
    const supersedes = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'supersede'").get();
    assert.equal(Number(supersedes.n), 2);
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'merge-s', tokenizer: conservativeTokens, H: 20000 });
    assert.equal(compiled.eligible_ids.includes(a.id), false);
    assert.equal(compiled.eligible_ids.includes(b.id), false);
    assert.ok(compiled.eligible_ids.includes(merged.memoryId));

    const c = makeActiveMemory(ctx, { text: '不一样的记忆' });
    assert.throws(
      () => handler.organize(dreamRuntime('org-merge-2'), { action: 'merge_exact', ids: [a.id, c.id] }),
      (err) => err.code === 'validation_error' || err.code === 'inactive_fact',
    );
    const dreamLinked = makeActiveMemory(ctx, { text: '带梦来源的记忆', origin: JSON.stringify(['d-abc#p1']) });
    const dreamLinked2 = makeActiveMemory(ctx, { text: '带梦来源的记忆', origin: JSON.stringify(['d-abc#p1']) });
    const suggestion = handler.organize(dreamRuntime('org-merge-3'), { action: 'merge_exact', ids: [dreamLinked.id, dreamLinked2.id] });
    assert.equal(suggestion.code, 'suggestion_only');
  });

  await t.test('supersede_proposal is stored but never executed without an owner executor', () => {
    const ctx = withContext(t);
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const oldMemory = makeActiveMemory(ctx, { text: '旧说法' });
    const newMemory = makeActiveMemory(ctx, { text: '新说法' });
    const handler = createDreamHandler(deps);
    const result = handler.organize(dreamRuntime('org-sup'), {
      action: 'supersede_proposal',
      oldMemoryId: oldMemory.id,
      newMemoryId: newMemory.id,
      reason: '更新',
    });
    assert.equal(result.code, 'action_execution_unavailable');
    assert.ok(result.proposalId);
    const stored = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'supersede-proposal'").get();
    assert.equal(Number(stored.n), 1);
    assert.equal(getMemory(ctx.main, oldMemory.id).text, '旧说法');
  });
});

test('P3-C1 migration contract', async (t) => {
  await t.test('versions reach current 8/4/2 with old SQL hashes unchanged', () => {
    const ctx = withContext(t);
    try {
      const versions = {};
      for (const label of ['main', 'control', 'dream']) {
        versions[label] = Number(
          ctx.handles[label].prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,
        );
      }
      assert.deepEqual(versions, { main: 8, control: 4, dream: 2 });
      const baseline = JSON.parse(
        fs.readFileSync(path.join(ROOT, '..', '_build', 'artifacts', 'p3', 'c1-baseline.json'), 'utf8'),
      );
      for (const [name, entry] of Object.entries(baseline.migrations)) {
        if (name === 'control-004.sql' || name === 'main-007.sql' || name === 'dream-002.sql') continue;
        const file = path.join(ROOT, 'src', 'storage', 'migrations', name);
        const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        assert.equal(digest, entry.sha256, `${name} must not change`);
      }
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('migrate --json keeps the marker on stderr and is idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c1-cli-'));
    try {
      const cli = path.join(ROOT, 'scripts', 'migrate.mjs');
      const first = spawnSync(process.execPath, [cli, '--data-dir', dir, '--json'], { encoding: 'utf8' });
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stderr, /MIGRATIONS_OK main=8 control=4 dream=2/);
      const payload = JSON.parse(first.stdout.trim());
      assert.deepEqual(payload.versions, { main: 8, control: 4, dream: 2 });
      assert.ok(payload.appliedNow.main.includes(8));
      const second = spawnSync(process.execPath, [cli, '--data-dir', dir, '--json'], { encoding: 'utf8' });
      assert.equal(second.status, 0, second.stderr);
      const again = JSON.parse(second.stdout.trim());
      assert.deepEqual(again.appliedNow, { main: [], control: [], dream: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('marker', (t2) => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    currentCtx = ctx;
    const deps = depsOf(ctx);
    const result = recordDream(deps, {
      runtime: dreamRuntime('marker-dream'),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '标记命题' }] },
    });
    const propositionId = result.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const markerDraft = draftFor('标记命题');
    const markerOwner = ownerObservation(ctx);
    const receiptId = receipt(ctx, {
      action: 'confirm-dream',
      targetIds: [result.dreamId],
      baseVersions: [textHash],
      payloadHash: dreamConfirmPayloadHash({
        dreamId: result.dreamId,
        propositionId,
        textHash,
        candidateDraft: markerDraft,
        evidenceRefs: [],
        path: 'owner_assertion',
        ownerObservationId: markerOwner,
      }),
    });
    const confirmed = confirmDream(deps, {
      receiptId,
      dreamId: result.dreamId,
      propositionId,
      textHash,
      candidateDraft: markerDraft,
      ownerObservationId: markerOwner,
    });
    const rows = ctx.dream.prepare('SELECT COUNT(*) AS n FROM confirmation_snapshots').get();
    const observation = ctx.main.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'dream'").get();
    const memory = confirmed.ok ? getMemory(ctx.main, confirmed.memoryId) : null;
    assert.equal(confirmed.ok, true);
    assert.equal(Number(rows.n), 1);
    assert.equal(Number(observation.n), 1);
    assert.ok(memory);
    t2.diagnostic(`P3_C1_OK dream_atomic=true confirm_snapshot=${rows.n} dream_in_S=0`);
    ctx.cleanup();
  });
});
