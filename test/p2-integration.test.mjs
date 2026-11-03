import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { openAll, closeAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll, migrateDatabase } from '../src/storage/migrate.mjs';
import {
  countRows,
  getMemory,
  insertObservation,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import { recordJudgments, recordRegisteredToolOutcome, recordVerdict, readJudgmentState } from '../src/write/judgment.mjs';
import { recordSelfNotes } from '../src/write/self-note.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { createProject, updateProject, projectOverview, projectCreatePayloadHash } from '../src/write/project.mjs';
import { recordCandidates } from '../src/write/candidate.mjs';
import {
  approveDuePolicy,
  duePayloadHash,
  handleOwnerDueCommand,
} from '../src/write/due-actions.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { createSelfHandler } from '../src/tools/self.mjs';
import { createProjectHandler } from '../src/tools/project.mjs';
import { createReadHandler } from '../src/tools/read.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import { recoverAll } from '../src/control/recovery.mjs';
import { createTestContext, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock, H: 200000 };
}

function rt(callId, overrides = {}) {
  return fakeRuntime({ callId, requestId: callId, ...overrides });
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function receipt(ctx, { action, targetIds = [], payloadHash = null, baseVersions = [] }) {
  seq += 1;
  return withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner',
      proposalId: `ip-${seq}`,
      action,
      payloadHash: payloadHash ?? `ih-${seq}`,
      targetIds,
      baseVersions,
      nonce: `in-${seq}`,
      inputEventId: `ie-${seq}`,
    }),
  ).receiptId;
}

function seedPending(ctx, text = '待确认惦记') {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 9900 + seq, text });
  insertObservation(ctx.main, observation);
  const result = recordCandidates(
    rt(`int-due-${seq}`),
    {
      items: [
        {
          observationId: observation.id,
          text,
          why: '期限',
          type: 'promise',
          evidenceRefs: [{ observationId: observation.id, sourceSpan: `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}` }],
        },
      ],
    },
    depsOf(ctx),
  );
  const memory = ctx.main.prepare('SELECT * FROM memories WHERE idempotency_key = ?').get(`promote:${result.items[0].id}`);
  return memory;
}

test('P2 integration: self / judgment / project / pending-due chain', async (t) => {
  const ctx = withContext(t);
  const deps = depsOf(ctx);

  // 1) judgment + self reflection -> needs-review -> defer (verdict untouched)
  const judgment = recordJudgments(
    rt('chain-j1'),
    { items: [{ verdict_text: '先跑测试再提交', basis: '上次事故', falsifier: '反例出现' }] },
    deps,
  ).items[0];
  const note = recordSelfNotes(
    rt('chain-n1'),
    { items: [{ text: '我在那条判断上想多了', reason: '反思', reflection_judgment_ids: [judgment.id] }] },
    deps,
  ).items[0];
  ctx.main.prepare('UPDATE review_queue SET deadline_at = ? WHERE object_id = ?').run('2000-01-01T00:00:00.000Z', judgment.id);
  const deferred = handleOwnerDueCommand; // keep import used below
  void deferred;
  const { deferExpiredNeedsReview } = await import('../src/write/judgment-review.mjs');
  const deferredResult = deferExpiredNeedsReview(ctx.main, { clock: ctx.clock, inputSeq: 0 });
  assert.equal(deferredResult.deferred, 1);
  assert.equal(readJudgmentState(ctx.main, judgment.id).unreviewed, true);
  assert.equal(readJudgmentState(ctx.main, judgment.id).verdict, null);

  // 2) trusted tool outcome moves outcome, not the verdict
  const outcome = recordRegisteredToolOutcome(
    { operationId: 'chain-op', judgmentId: judgment.id, exitCode: 0, resultRef: 'obs_x', resultHash: 'h' },
    { ...deps, runtime: rt('chain-wrapper') },
  );
  assert.equal(outcome.items[0].status, 'found');
  recordVerdict(rt('chain-v1'), { items: [{ judgmentId: judgment.id, by: 'self', result: 'pending', basis: 'b' }] }, deps);
  const view = ctx.main.prepare('SELECT * FROM judgment_current WHERE id = ?').get(judgment.id);
  assert.equal(view.outcome, 'done');
  assert.equal(view.verdict_result, 'pending');

  // 3) project identity + one update while keeping the model source
  const projectSnapshot = { current_task: '集成测试', progress: null, next_action: null, blockers: null };
  const projectReceipt = receipt(ctx, {
    action: 'project-create',
    payloadHash: projectCreatePayloadHash({ name: '第二批收尾', snapshot: projectSnapshot }),
  });
  const project = createProject(deps, { name: '第二批收尾', receiptId: projectReceipt, snapshot: projectSnapshot });
  assert.equal(project.ok, true);
  const updated = updateProject(deps, {
    projectId: project.projectId,
    baseRevision: 1,
    patch: { progress: '模型报告完成' },
    evidenceRefs: [],
    requestId: 'chain-update',
    runtime: rt('chain-update'),
  });
  assert.equal(updated.ok, true);
  const overview = projectOverview(ctx.main, { projectId: project.projectId });
  assert.equal(overview.model_reported_complete, true);
  assert.equal(overview.completion.verified, false);

  // 4) pending-due recall + owner confirmation
  const dueMemory = seedPending(ctx, '集成惦记');
  approveDuePolicy(deps, { policyRevision: 'due-policy-v1' });
  const queue = ctx.main.prepare('SELECT revision FROM due_queue WHERE memory_id = ?').get(dueMemory.id);
  const confirmed = handleOwnerDueCommand(deps, {
    text: `/mem due-confirm ${dueMemory.id} ${queue.revision} ${duePayloadHash(dueMemory.id, queue.revision)}`,
    inputEventId: 'chain-confirm',
    ownerId: 'owner',
  });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal(getMemory(ctx.main, dueMemory.id).due_state, 'open');

  // 5) one compile round carries project + pending review partition
  const compiled = compileRound({
    ...deps,
    mode: 'work',
    roundId: 'chain-compile',
    tokenizer: conservativeTokens,
    H: 20000,
    project: overview,
  });
  assert.equal(compiled.delivery, 'unknown');
  assert.ok(compiled.section.text.includes('第二批收尾'));
  assert.ok(compiled.section.text.includes('待确认惦记 0 条'));
  const manifest = JSON.parse(
    ctx.control.prepare('SELECT manifest_json FROM context_snapshots WHERE id = ?').get(compiled.snapshot_revision).manifest_json,
  );
  assert.ok(manifest.typed_items.some((item) => item.kind === 'project'));

  // 6) offline tools keep working without any host or injection switch
  const handlers = {
    self: createSelfHandler({ main: ctx.main, clock: ctx.clock }),
    project: createProjectHandler({ main: ctx.main, clock: ctx.clock }),
    read: createReadHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock }),
    record: createRecordHandler(deps),
  };
  assert.equal(handlers.self.get({ kind: 'self_note', ids: [note.id] }).status, 'ok');
  assert.equal(handlers.project.get({ projectId: project.projectId }).status, 'ok');
  assert.equal(handlers.read.review({ kind: 'needs-review' }).status, 'ok');
  const toolJudgment = handlers.record.record(rt('chain-tool-j'), {
    kind: 'judgment',
    items: [{ verdict_text: '集成里再写一条判断', basis: 'b', falsifier: 'f' }],
  });
  assert.equal(toolJudgment.items[0].status, 'found');
  t.diagnostic('P2_M5_OK integration=4 chain=judgment+self+project+due offline_tools=true');
});

test('P2 integration: offline capability and restart recovery', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p2int-'));
  const clock = mutableClock().clock;
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  migrateAll(handles, { clock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  const deps = { main: handles.main, control: handles.control, clock };

  // A control-receipt failure leaves the business row and returns unknown.
  let closed = false;
  let commits = 0;
  const failing = {
    ...deps,
    commitHooks: {
      beforeControlComplete() {
        commits += 1;
        // First commit is the model observation; fail the judgment receipt only.
        if (commits >= 2 && !closed) {
          closed = true;
          handles.control.close();
        }
      },
    },
  };
  const result = recordJudgments(
    rt('recover-j'),
    { items: [{ verdict_text: '回执失败仍应保留判断行', basis: 'b', falsifier: 'f' }] },
    failing,
  );
  assert.equal(result.items[0].status, 'unknown');
  assert.equal(countRows(handles.main, 'judgments'), 1);
  closeAll(handles);

  const reopened = openAll(config);
  try {
    const recovered = recoverAll({ main: reopened.main, control: reopened.control, clock });
    assert.ok(recovered.some((row) => row.kind === 'recovered_found'), JSON.stringify(recovered));
    const operation = reopened.control.prepare("SELECT * FROM operations WHERE status = 'found'").get();
    assert.ok(operation, 'control ledger records the recovered object');
  } finally {
    closeAll(reopened);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  void DAY;
});

test('P2 integration: first-batch upgrade stays consistent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p2int-up-'));
  const clock = mutableClock().clock;
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  const migrations = discoverMigrations();
  for (const db of ['main', 'control', 'dream']) {
    migrateDatabase(handles[db], db, migrations[db].filter((migration) => migration.version <= (db === 'main' ? 3 : db === 'control' ? 2 : 1)), clock);
  }
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  try {
    const applied = migrateAll(handles, { clock });
    const latest = {
      main: Math.max(...migrations.main.map((migration) => migration.version)),
      control: Math.max(...migrations.control.map((migration) => migration.version)),
      dream: Math.max(...migrations.dream.map((migration) => migration.version)),
    };
    assert.deepEqual(applied.versions, latest);
    const second = migrateAll(handles, { clock });
    assert.deepEqual(second.results.main.appliedNow, []);
    assert.deepEqual(second.results.control.appliedNow, []);
    for (const db of ['main', 'control', 'dream']) {
      assert.equal(handles[db].prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(handles[db].prepare('PRAGMA foreign_key_check').all().length, 0);
    }
  } finally {
    closeAll(handles);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
