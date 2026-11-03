import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll } from '../src/storage/migrate.mjs';
import { insertObservation, seedInitialRegistry } from '../src/storage/repositories.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { confirmDream, dreamConfirmPayloadHash } from '../src/dream/confirm.mjs';
import { confirmationState, dreamStatus } from '../src/dream/replay.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { recoverAll } from '../src/control/recovery.mjs';
import { makeObservation, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function openCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p3c1r-'));
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
  return {
    dir,
    clock,
    handles,
    main: handles.main,
    control: handles.control,
    dream: handles.dream,
    deps: { main: handles.main, control: handles.control, dream: handles.dream, clock },
    cleanup() {
      try {
        closeAll(handles);
      } catch {
        // a closed control handle in failure scenarios is expected
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function dreamRuntime(callId) {
  return fakeRuntime({ role: 'dream', callId, requestId: callId });
}

test('P3-C1 recovery: dream transaction failure leaves no partial dream', (t) => {
  const ctx = openCtx();
  t.after(() => ctx.cleanup());
  let commits = 0;
  const failing = {
    ...ctx.deps,
    commitHooks: {
      beforeReserve() {
        commits += 1;
        if (commits === 2) throw new Error('dream_txn_fault');
      },
    },
  };
  assert.throws(
    () =>
      recordDream(failing, {
        runtime: dreamRuntime('fail-dream'),
        item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'p1' }, { text: 'p2' }] },
      }),
    /dream_txn_fault/,
  );
  assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM dreams').get().n, 0);
  assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM propositions').get().n, 0);
  assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'model'").get().n, 1);

  const retried = recordDream(ctx.deps, {
    runtime: dreamRuntime('fail-dream'),
    item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'p1' }, { text: 'p2' }] },
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM propositions').get().n, 2);
});

test('P3-C1 recovery: control receipt failure after dream confirm is recoverable', (t) => {
  const ctx = openCtx();
  t.after(() => ctx.cleanup());
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });

  const dreamResult = recordDream(ctx.deps, {
    runtime: dreamRuntime('recover-confirm'),
    item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '可恢复命题' }] },
  });
  const propositionId = dreamResult.propositionIds[0];
  const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
  const recoverDraft = {
    text: '可恢复命题',
    detail: null,
    why: '梦后形成的判断',
    type: 'fact',
    scene: 'work',
    scope: 'work-only',
    components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' },
  };
  const ownerObservation = makeObservation(ctx, { messageSeq: 9401, text: '主人批准可恢复命题' });
  insertObservation(ctx.main, ownerObservation);
  const receiptId = withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner',
      proposalId: 'recover-confirm',
      action: 'confirm-dream',
      payloadHash: dreamConfirmPayloadHash({
        dreamId: dreamResult.dreamId,
        propositionId,
        textHash,
        candidateDraft: recoverDraft,
        evidenceRefs: [],
        path: 'owner_assertion',
        ownerObservationId: ownerObservation.id,
      }),
      targetIds: [dreamResult.dreamId],
      baseVersions: [textHash],
      nonce: 'recover-nonce',
      inputEventId: 'recover-input',
    }),
  ).receiptId;

  let commits = 0;
  let closed = false;
  const failing = {
    ...ctx.deps,
    commitHooks: {
      beforeControlComplete() {
        commits += 1;
        if (commits === 2 && !closed) {
          closed = true;
          ctx.control.close();
        }
      },
    },
  };
  let outcome;
  try {
    outcome = confirmDream(failing, {
      receiptId,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: recoverDraft,
      ownerObservationId: ownerObservation.id,
    });
  } catch (err) {
    outcome = { thrown: err.message };
  }
  assert.ok(outcome === undefined || outcome.ok !== true);
  // Dream side committed and the snapshot exists; main candidate was written
  // before the control receipt failed, so recovery must find it.
  assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM confirmation_snapshots').get().n, 1);
  // The observation commit is the interrupted step here, so the candidate does not exist yet.
  assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'confirm'").get().n, 0);
  assert.equal(confirmationState(ctx.dream).get(propositionId).valid, true);

  closeAll(ctx.handles);
  const reopened = openAll(resolveConfig({ dataDir: ctx.dir }));
  try {
    const recovered = recoverAll({ main: reopened.main, control: reopened.control, dream: reopened.dream, clock: ctx.clock });
    assert.equal(reopened.main.prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'confirm'").get().n, 1);
    assert.equal(reopened.main.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 1);
    assert.ok(
      recovered.some((row) => row.kind === 'recovered_found' || row.kind === 'reconciliation'),
      JSON.stringify(recovered),
    );
    assert.equal(confirmationState(reopened.dream).get(propositionId).valid, true);
    assert.equal(dreamStatus(reopened.dream, dreamResult.dreamId).propositions.length, 1);
  } finally {
    closeAll(reopened);
  }
});
