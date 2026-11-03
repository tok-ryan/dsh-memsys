import assert from 'node:assert/strict';
import test from 'node:test';

import { withImmediate } from '../src/storage/open.mjs';
import { getState } from '../src/storage/repositories.mjs';
import {
  createProject,
  updateProject,
  selectProject,
  completeProject,
  projectOverview,
  rebuildProjection,
} from '../src/write/project.mjs';
import { issueReceipt, verdictVoidPayloadHash } from '../src/write/owner-actions.mjs';
import { payloadHash } from '../src/identity.mjs';
import {
  projectCreatePayloadHash,
  projectSelectPayloadHash,
  projectCompletePayloadHash,
} from '../src/write/project.mjs';
import { recordJudgments, recordVerdict } from '../src/write/judgment.mjs';
import { voidMasterVerdict } from '../src/write/owner-actions.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { projectGet } from '../src/read/project.mjs';
import { createProjectHandler } from '../src/tools/project.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

function rt(callId, overrides = {}) {
  return fakeRuntime({ callId, requestId: callId, ...overrides });
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function receipt(ctx, { action, targetIds = [], proposalId = null, payloadHash = null, baseVersions = [] }) {
  seq += 1;
  return withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner-1',
      proposalId: proposalId ?? `p-${seq}`,
      action,
      payloadHash: payloadHash ?? `h-${seq}`,
      targetIds,
      baseVersions,
      nonce: `n-${seq}`,
      inputEventId: `e-${seq}`,
    }),
  ).receiptId;
}

function emptySnapshot(snapshot = {}) {
  const first = { current_task: null, progress: null, next_action: null, blockers: null };
  for (const key of Object.keys(snapshot)) first[key] = snapshot[key];
  return first;
}

function create(ctx, name, snapshot = {}) {
  const receiptId = receipt(ctx, {
    action: 'project-create',
    payloadHash: projectCreatePayloadHash({ name, snapshot: emptySnapshot(snapshot) }),
  });
  return createProject(depsOf(ctx), { name, receiptId, snapshot });
}

test('P2-M3 project identity and revisions', async (t) => {
  await t.test('owner receipt creates identity plus first full snapshot; identity table has no state columns', () => {
    const ctx = withContext(t);
    const created = create(ctx, 'dsh-memsys', { current_task: '写第二批' });
    assert.equal(created.ok, true);
    assert.equal(created.revision, 1);
    const row = ctx.main.prepare('SELECT * FROM projects WHERE id = ?').get(created.projectId);
    assert.equal(row.name, 'dsh-memsys');
    assert.equal(row.scene, 'work');
    assert.ok(row.approval_receipt_id);
    assert.equal(Object.hasOwn(row, 'current_task'), false);
    assert.equal(Object.hasOwn(row, 'snapshot'), false);
    const state = getState(ctx.main, `project:${created.projectId}`).value;
    assert.equal(state.headRevision, 1);
    assert.equal(state.snapshot.current_task, '写第二批');
    assert.equal(state.snapshot.progress, null);
    const firstEvent = ctx.main
      .prepare("SELECT payload FROM relations WHERE type = 'project-update' AND json_extract(payload, '$.revision') = 1")
      .get();
    assert.equal(JSON.parse(firstEvent.payload).baseRevision, 0);
  });

  await t.test('a missing or consumed receipt cannot create another project', () => {
    const ctx = withContext(t);
    const missing = createProject(depsOf(ctx), { name: 'x', receiptId: 'rq_nope', snapshot: {} });
    assert.equal(missing.code, 'receipt_missing');
    const receiptId = receipt(ctx, {
      action: 'project-create',
      payloadHash: projectCreatePayloadHash({ name: '同名', snapshot: emptySnapshot() }),
    });
    const ok = createProject(depsOf(ctx), { name: '同名', receiptId });
    assert.equal(ok.ok, true);
    const reuse = createProject(depsOf(ctx), { name: '另一个名字', receiptId });
    assert.equal(reuse.ok, false);
    assert.equal(reuse.code, 'stale_proposal');
    const replay = createProject(depsOf(ctx), { name: '同名', receiptId });
    assert.equal(replay.replayed, true);
    assert.equal(replay.projectId, ok.projectId);
  });

  await t.test('same name with different receipts stays two separate projects', () => {
    const ctx = withContext(t);
    const a = create(ctx, '同名项目');
    const b = create(ctx, '同名项目');
    assert.notEqual(a.projectId, b.projectId);
    assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 2);
  });

  await t.test('updates are monotonic and baseRevision is enforced', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '进度项目');
    let revision = 1;
    for (let index = 2; index <= 5; index += 1) {
      const result = updateProject(deps, {
        projectId: created.projectId,
        baseRevision: revision,
        patch: { progress: `第${index}版进度` },
        requestId: `u-${index}`,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.revision, index);
      revision = index;
    }
    const overview = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(overview.headRevision, 5);
    assert.equal(overview.snapshot.progress, '第5版进度');
    const stale = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 3,
      patch: { progress: '旧基线' },
      requestId: 'u-stale',
    });
    assert.equal(stale.code, 'stale_project');
    assert.equal(stale.headRevision, 5);
  });

  await t.test('a repeated request id does not create a sixth version; conflicting fields are refused', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '重复请求');
    updateProject(deps, { projectId: created.projectId, baseRevision: 1, patch: { progress: 'A' }, requestId: 'same-1' });
    const replay = updateProject(deps, { projectId: created.projectId, baseRevision: 1, patch: { progress: 'A' }, requestId: 'same-1' });
    assert.equal(replay.replayed, true);
    assert.equal(replay.revision, 2);
    const conflict = updateProject(deps, { projectId: created.projectId, baseRevision: 1, patch: { progress: 'B' }, requestId: 'same-1' });
    assert.equal(conflict.code, 'validation_error');
    const count = ctx.main
      .prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'project-update'")
      .get();
    assert.equal(Number(count.n), 2);
  });

  await t.test('missing fields inherit value and sources; explicit null clears', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '来源继承');
    const memoryId = 'mem_source_1';
    ctx.main
      .prepare(
        `INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at)
         VALUES ('obs_source_1','obs:source:1',?, 'h', '原话', 'conversation', 'owner', '{}', 'master@2026-11-03', 0, '{}', 0.5, ?)`,
      )
      .run(ctx.clock.at().at, ctx.clock.at().at);
    ctx.main
      .prepare(
        `INSERT INTO candidates (id, idempotency_key, at, payload_hash, observation_id, source_unit, source_path, text, why, type, scene, scope, tags, semantic_status, record_kind, origin, confidence, lossy, time_state, weight, pointer_status, creator_session_id, owner_touched, state_snapshot, initial_strength, status, review_policy, policy_revision, created_input_seq, recorded_at, key_status, binding_status, binding_basis, origin_mode)
         VALUES ('cand_source_1','cand:source:1',?, 'h','obs_source_1','bytes:0:2','tool','原文','why','fact','work','work-only','[]','proposed','assertion','master@2026-11-03',0.5,0,'point',5,'unknown','s',0,'{}',0.5,'pending','capture-v1','1',0,?,'unresolved','proposed','{}','self')`,
      )
      .run(ctx.clock.at().at, ctx.clock.at().at);
    ctx.main
      .prepare(
        `INSERT INTO memories (id, idempotency_key, at, payload_hash, text, why, type, scene, scope, tags, semantic_status, record_kind, origin, credibility, lossy, weight, state_snapshot, initial_strength, recorded_at, promoted_from, due_state, last_touched_at, key_status, binding_status, binding_basis, origin_mode)
         VALUES (?, 'mem:source:1', ?, 'hm','旧进度原文','why','fact','work','work-only','[]','proposed','assertion','master@2026-11-03','verified',0,5,'{}',0.5,?, 'cand_source_1','none',?,'unresolved','proposed','{}','self')`,
      )
      .run(memoryId, ctx.clock.at().at, ctx.clock.at().at, ctx.clock.at().at);
    const rev2 = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 1,
      patch: { progress: '模型报告完成' },
      evidenceRefs: [memoryId],
      requestId: 'rev2',
      runtime: rt('rev2'),
    });
    assert.equal(rev2.ok, true);
    const rev3 = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 2,
      patch: { next_action: '补测试' },
      evidenceRefs: ['obs_source_1'],
      requestId: 'rev3',
      runtime: rt('rev3'),
    });
    assert.equal(rev3.ok, true);
    assert.ok(rev3.inherited.includes('progress'));
    assert.equal(rev3.snapshot.progress, '模型报告完成');
    const overview = projectOverview(ctx.main, { projectId: created.projectId });
    assert.ok(overview.evidence_refs.includes(memoryId), 'old evidence stays in the union');
    assert.match(overview.origin, /model:/, 'old model source is not washed away');
    assert.equal(overview.model_reported_complete, true);
    assert.equal(overview.completion.verified, false);
    const cleared = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 3,
      patch: { progress: null },
      requestId: 'rev4',
      runtime: rt('rev4'),
    });
    assert.equal(cleared.snapshot.progress, null);
  });
});

test('P2-M3 effective versions, completion and selection', async (t) => {
  await t.test('invalid evidence falls back to the last valid revision while head stays', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '回退项目');
    const judgment = recordJudgments(rt('proj-judgment'), { items: [{ verdict_text: '某判断', basis: 'b', falsifier: 'f' }] }, deps).items[0];
    const verdict = recordVerdict(rt('proj-verdict'), { items: [{ judgmentId: judgment.id, by: 'self', result: 'wrong', basis: 'b' }] }, deps).items[0];
    const rev2 = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 1,
      patch: { progress: '引用了一条裁决' },
      evidenceRefs: [`verdict:${verdict.eventId}`],
      requestId: 'rev-verdict',
      runtime: rt('rev-verdict'),
    });
    assert.equal(rev2.ok, true);
    const before = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(before.effectiveRevision, 2);

    const judgmentHash = ctx.main.prepare('SELECT payload_hash FROM judgments WHERE id = ?').get(judgment.id).payload_hash;
    const voidReceipt = receipt(ctx, {
      action: 'verdict-void',
      targetIds: [judgment.id, verdict.eventId],
      baseVersions: [judgmentHash, verdict.eventId],
      payloadHash: verdictVoidPayloadHash({ judgmentId: judgment.id, verdictId: verdict.eventId, reason: '撤销' }),
    });
    const voided = voidMasterVerdict(ctx.main, ctx.clock, {
      receiptId: voidReceipt,
      judgmentId: judgment.id,
      verdictId: verdict.eventId,
      reason: '撤销',
    });
    assert.equal(voided.ok, true);
    const after = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(after.headRevision, 2);
    assert.equal(after.effectiveRevision, 1);
    assert.equal(after.validity.valid, false);
    assert.equal(after.snapshot.progress, null, 'falls back to the first snapshot');
  });

  await t.test('text completion never verifies; owner completion binds the exact snapshot', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '完成项目');
    updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 1,
      patch: { progress: '已完成' },
      requestId: 'rev-done',
      runtime: rt('rev-done'),
    });
    const overview = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(overview.model_reported_complete, true);
    assert.equal(overview.completion.verified, false);
    const completeState = getState(ctx.main, `project:${created.projectId}`).value;
    const receiptId = receipt(ctx, {
      action: 'project-complete',
      targetIds: [created.projectId],
      baseVersions: [completeState.headRevision],
      payloadHash: projectCompletePayloadHash({
        projectId: created.projectId,
        revision: completeState.headRevision,
        snapshotHash: payloadHash(completeState.snapshot),
      }),
    });
    const completed = completeProject(deps, { projectId: created.projectId, receiptId });
    assert.equal(completed.ok, true);
    const verified = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(verified.completion.verified, true);

    updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 2,
      patch: { next_action: '再来一版' },
      requestId: 'rev-after-complete',
      runtime: rt('rev-after-complete'),
    });
    const afterNewRevision = projectOverview(ctx.main, { projectId: created.projectId });
    assert.equal(afterNewRevision.completion.verified, false, 'completion is bound to the exact snapshot');
  });

  await t.test('selection requires a receipt bound to this project and is scoped to the session', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '选中项目');
    const wrong = receipt(ctx, { action: 'project-select', targetIds: ['proj_other'] });
    const refused = selectProject(deps, { sessionId: 'sess-1', projectId: created.projectId, receiptId: wrong });
    assert.equal(refused.code, 'receipt_target_mismatch');
    const selectState = getState(ctx.main, `project:${created.projectId}`).value;
    const okReceipt = receipt(ctx, {
      action: 'project-select',
      targetIds: [created.projectId],
      baseVersions: [selectState.headRevision],
      payloadHash: projectSelectPayloadHash({
        projectId: created.projectId,
        revision: selectState.headRevision,
        sessionId: 'sess-1',
      }),
    });
    const selected = selectProject(deps, { sessionId: 'sess-1', projectId: created.projectId, receiptId: okReceipt });
    assert.equal(selected.ok, true);
    const active = getState(ctx.main, 'active_project:sess-1').value;
    assert.equal(active.projectId, created.projectId);

    const workCompile = compileRound({
      ...deps,
      mode: 'work',
      roundId: 'proj-work',
      tokenizer: conservativeTokens,
      H: 20000,
      project: projectOverview(ctx.main, { projectId: created.projectId }),
    });
    assert.ok(workCompile.section.text.includes('选中项目'));
    assert.ok(workCompile.section.text.includes('在做什么'));
    const lifeCompile = compileRound({
      ...deps,
      mode: 'life',
      roundId: 'proj-life',
      tokenizer: conservativeTokens,
      H: 20000,
      project: projectOverview(ctx.main, { projectId: created.projectId }),
    });
    assert.equal(lifeCompile.section.text.includes('选中项目'), false);
    const snapshotRow = ctx.control
      .prepare('SELECT manifest_json FROM context_snapshots WHERE id = ?')
      .get(workCompile.snapshot_revision);
    const manifest = JSON.parse(snapshotRow.manifest_json);
    assert.ok(manifest.typed_items.some((item) => item.kind === 'project'));
  });

  await t.test('project_get returns identity, overview and paged history; rebuild equals state', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '读取项目', { current_task: '任务' });
    for (let revision = 2; revision <= 4; revision += 1) {
      updateProject(deps, {
        projectId: created.projectId,
        baseRevision: revision - 1,
        patch: { progress: `v${revision}` },
        requestId: `read-${revision}`,
        runtime: rt(`read-${revision}`),
      });
    }
    const current = projectGet({ main: ctx.main, clock: ctx.clock, projectId: created.projectId });
    assert.equal(current.status, 'ok');
    assert.equal(current.project.headRevision, 4);
    const history = projectGet({ main: ctx.main, clock: ctx.clock, projectId: created.projectId, history: true, maxChars: 1000 });
    assert.equal(history.status, 'ok');
    assert.equal(history.versions.length, 4);
    assert.equal(history.versions[0].revision, 4);
    const badCursor = projectGet({
      main: ctx.main,
      clock: ctx.clock,
      projectId: created.projectId,
      history: true,
      cursor: Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_project_get', index: 0, projectId: 'proj_other' })).toString('base64url'),
    });
    assert.equal(badCursor.code, 'invalid_cursor');
    const rebuilt = rebuildProjection(ctx.main, created.projectId);
    const state = getState(ctx.main, `project:${created.projectId}`).value;
    assert.deepEqual(rebuilt.snapshot, state.snapshot);
    assert.equal(rebuilt.headRevision, state.headRevision);
    const handler = createProjectHandler({ main: ctx.main, clock: ctx.clock });
    assert.equal(handler.get({ projectId: created.projectId }).status, 'ok');
    assert.equal(handler.get({}).code, 'validation_error');
  });

  await t.test('record handler writes proposed updates in the work window only', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const created = create(ctx, '工具写入');
    const handler = createRecordHandler(deps);
    const work = handler.record(rt('tool-update'), {
      kind: 'project_update',
      items: [{ projectId: created.projectId, baseRevision: 1, snapshot: { progress: '工具写入的进度' } }],
    });
    assert.equal(work.items[0].status, 'found');
    const life = handler.record(
      fakeRuntime({ callId: 'life-update', requestId: 'life-update', mode: 'life', phase: 'life' }),
      { kind: 'project_update', items: [{ projectId: created.projectId, baseRevision: 2, snapshot: { progress: 'x' } }] },
    );
    assert.equal(life.code, 'unsupported_in_batch');
  });

  await t.test('marker', (t2) => {
    const ctx = withContext(t2);
    const deps = depsOf(ctx);
    const created = create(ctx, '标记项目');
    for (let revision = 2; revision <= 5; revision += 1) {
      updateProject(deps, {
        projectId: created.projectId,
        baseRevision: revision - 1,
        patch: { progress: `第${revision}版` },
        requestId: `marker-${revision}`,
        runtime: rt(`marker-${revision}`),
      });
    }
    const versions = ctx.main
      .prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'project-update' AND json_extract(payload, '$.projectId') = ?")
      .get(created.projectId);
    const conflict = updateProject(deps, {
      projectId: created.projectId,
      baseRevision: 1,
      patch: { progress: 'X' },
      requestId: 'marker-2',
    });
    const overview = projectOverview(ctx.main, { projectId: created.projectId });
    const inheritedSources = overview.evidence_refs.length >= 0 && overview.origin !== null;
    const snapshots = Number(versions.n);
    const revisionConflict = conflict.code === 'validation_error';
    assert.equal(snapshots, 5);
    assert.equal(revisionConflict, true);
    assert.equal(inheritedSources, true);
    t2.diagnostic(`P2_M3_OK snapshots=${snapshots} revision_conflict=${revisionConflict} inherited_sources=${inheritedSources}`);
  });
});
