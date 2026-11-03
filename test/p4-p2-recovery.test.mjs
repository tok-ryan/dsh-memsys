import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll } from '../src/storage/migrate.mjs';
import {
  countRows,
  getCandidate,
  getObservation,
  insertObservation,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import { ingestInput, observeInput } from '../src/write/observe.mjs';
import { recordJudgments } from '../src/write/judgment.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { confirmDream, unconfirmDream, voidDream, dreamConfirmPayloadHash, unconfirmDreamPayloadHash, voidDreamPayloadHash } from '../src/dream/confirm.mjs';
import { confirmationState } from '../src/dream/replay.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { recoverAll } from '../src/control/recovery.mjs';
import { reserveAttempt, completeAttempt } from '../src/control/ledger.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { createTestContext, mutableClock, makeObservation, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function openCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p4p2-'));
  const clock = mutableClock().clock;
  const handles = openAll(resolveConfig({ dataDir: dir }));
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
    dir, clock, handles, main: handles.main, control: handles.control, dream: handles.dream,
    cleanup() {
      try { closeAll(handles); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('P4/P2 L1: recovery cannot treat object existence as success', (t) => {
  const ctx = openCtx();
  t.after(() => ctx.cleanup());
  let commits = 0;
  const failing = {
    main: ctx.main, control: ctx.control, clock: ctx.clock,
    commitHooks: {
      beforeControlComplete() {
        commits += 1;
        if (commits === 1) ctx.control.close();
      },
    },
  };
  let outcome;
  try {
    outcome = observeInput(fakeRuntime({ callId: 'l1-observe', messageSeq: 9101 }), { text: 'L1 原话', messageSeq: 9101 }, failing);
  } catch (err) {
    outcome = { error: err.message };
  }
  const observation = ctx.main.prepare('SELECT * FROM observations ORDER BY id LIMIT 1').get();
  assert.ok(observation, 'observation was written before the control receipt failed');
  // Tamper the business row after the interrupted attempt (test-only trigger drop).
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_observations_no_update');
  ctx.main.prepare('UPDATE observations SET text = ?, payload_hash = ? WHERE id = ?').run('被改过的原话', 'tampered-hash', observation.id);
  closeAll(ctx.handles);
  const reopened = openAll(resolveConfig({ dataDir: ctx.dir }));
  try {
    const recovered = recoverAll({ main: reopened.main, control: reopened.control, clock: ctx.clock });
    const hit = recovered.find((row) => row.objectKey === `main:${observation.id}`);
    assert.ok(hit, JSON.stringify(recovered));
    assert.notEqual(hit.kind, 'recovered_found', 'tampered object must not be reported as found');
  } finally {
    closeAll(reopened);
  }
});

test('P4/P2 L2: an interrupted observation gets its capture rebuilt once', (t) => {
  const ctx = openCtx();
  t.after(() => ctx.cleanup());
  let commits = 0;
  const failing = {
    main: ctx.main, control: ctx.control, clock: ctx.clock,
    commitHooks: {
      beforeReserve() {
        commits += 1;
        if (commits === 2) throw new Error('capture_fault'); // capture never writes
      },
    },
  };
  try {
    ingestInput(fakeRuntime({ callId: 'l2-ingest', messageSeq: 9102 }), { text: 'L2 原话', messageSeq: 9102 }, failing);
  } catch {
    // expected interrupted capture
  }
  closeAll(ctx.handles);
  const reopened = openAll(resolveConfig({ dataDir: ctx.dir }));
  try {
    recoverAll({ main: reopened.main, control: reopened.control, clock: ctx.clock });
    const captures = reopened.main
      .prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'capture'")
      .get();
    assert.equal(Number(captures.n), 1, 'exactly one capture candidate after recovery');
    const done = reopened.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'capture-job' AND json_extract(payload, '$.status') = 'done'").get();
    assert.equal(Number(done.n), 1);
  } finally {
    closeAll(reopened);
  }
});

test('P4/P2 L3: dream confirm is resumable and the snapshot is complete', async (t) => {
  await t.test('ownerObservationId is required', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    const dream = recordDream(deps, {
      runtime: fakeRuntime({ role: 'dream', callId: 'l3-dream' }),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'L3 命题' }] },
    });
    const propositionId = dream.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const draft = {
      text: 'L3 命题', detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
      tags: ['t'], weight: 7, structuredValue: { k: 1 },
      components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' },
    };
    const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner', proposalId: 'l3', action: 'confirm-dream',
      payloadHash: dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: null }),
      targetIds: [dream.dreamId], baseVersions: [textHash], nonce: 'n', inputEventId: 'e',
    })).receiptId;
    const refused = confirmDream(deps, {
      receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft,
      ownerObservationId: null,
    });
    assert.equal(refused.code, 'validation_error');
    assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM confirmation_snapshots').get().n, 0);
  });

  await t.test('an interrupted main step resumes from the confirm task', () => {
    const ctx = openCtx();
    t.after(() => ctx.cleanup());
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
    const dream = recordDream(deps, {
      runtime: fakeRuntime({ role: 'dream', callId: 'l3-dream-2' }),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'L3 可续命题' }] },
    });
    const propositionId = dream.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const ownerObservation = makeObservation(ctx, { messageSeq: 9201, text: '主人批准 L3' });
    insertObservation(ctx.main, ownerObservation);
    const draft = {
      text: 'L3 可续命题', detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
      tags: ['t'], weight: 7, structuredValue: { k: 1 },
      components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' },
    };
    const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner', proposalId: 'l3-2', action: 'confirm-dream',
      payloadHash: dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: ownerObservation.id }),
      targetIds: [dream.dreamId], baseVersions: [textHash], nonce: 'n2', inputEventId: 'e2',
    })).receiptId;
    let commits = 0;
    const failing = {
      ...deps,
      commitHooks: {
        beforeControlComplete() {
          commits += 1;
          if (commits === 2) ctx.control.close(); // dream ok, main observation receipt fails
        },
      },
    };
    let result;
    try {
      result = confirmDream(failing, {
        receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft,
        ownerObservationId: ownerObservation.id,
      });
    } catch (err) {
      result = { thrown: err.message };
    }
    assert.ok(result === undefined || result.ok !== true);
    closeAll(ctx.handles);
    const reopened = openAll(resolveConfig({ dataDir: ctx.dir }));
    try {
      const recovered = recoverAll({ main: reopened.main, control: reopened.control, dream: reopened.dream, clock: ctx.clock });
      assert.ok(recovered.some((row) => row.kind === 'dream_confirm_resumed' || row.kind === 'recovered_found' || row.kind === 'reconciliation'), JSON.stringify(recovered));
      const memories = reopened.main.prepare("SELECT * FROM memories WHERE text = 'L3 可续命题'").all();
      assert.equal(memories.length, 1, 'the interrupted confirm completes exactly one memory');
      const snapshot = reopened.dream.prepare('SELECT payload FROM confirmation_snapshots ORDER BY at DESC LIMIT 1').get();
      const payload = JSON.parse(snapshot.payload);
      assert.ok(payload.candidateDraft.tags.includes('t'));
      assert.equal(payload.candidateDraft.weight, 7);
      assert.ok(payload.candidateDraft.structuredValue);
      assert.ok(payload.owner_observation_id);
      assert.ok(Array.isArray(payload.evidence_snapshot) && payload.evidence_snapshot.length >= 1);
    } finally {
      closeAll(reopened);
    }
  });
});

test('P4/P2 E5: failures accumulate by logical object, not request key', (t) => {
  const ctx = openCtx();
  t.after(() => ctx.cleanup());
  for (let index = 1; index <= 3; index += 1) {
    const reserved = reserveAttempt(ctx.control, ctx.clock, {
      objectKey: 'main:obs_e5',
      targetDb: 'main',
      requestKey: `e5-request-${index}`,
      payloadHash: `hash-${index}`,
      immutablePayload: JSON.stringify({ index }),
      targetIds: ['obs_e5'],
    });
    completeAttempt(ctx.control, ctx.clock, {
      objectKey: 'main:obs_e5',
      operationId: reserved.operationId,
      generation: reserved.generation,
      attemptNo: reserved.attemptNo,
      result: 'unknown',
      error: 'fault',
    });
  }
  assert.throws(
    () =>
      reserveAttempt(ctx.control, ctx.clock, {
        objectKey: 'main:obs_e5',
        targetDb: 'main',
        requestKey: 'e5-request-4',
        payloadHash: 'hash-4',
        immutablePayload: JSON.stringify({ index: 4 }),
        targetIds: ['obs_e5'],
      }),
    (err) => err.code === 'object_frozen',
  );
});

test('P4/P2 E6: revocation folds by source chain and void works by dreamId', async (t) => {
  await t.test('the latest revocation falls back to the previous valid confirmation', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
    const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
    const dream = recordDream(deps, {
      runtime: fakeRuntime({ role: 'dream', callId: 'e6-dream' }),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: 'E6 命题' }] },
    });
    const propositionId = dream.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const ownerObservation = makeObservation(ctx, { messageSeq: 9301, text: '主人批准 E6' });
    insertObservation(ctx.main, ownerObservation);
    const draft = {
      text: 'E6 命题', detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
      components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' },
    };
    const confirmOnce = () => {
      const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
        ownerId: 'owner', proposalId: `e6-${Math.random()}`, action: 'confirm-dream',
        payloadHash: dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: ownerObservation.id }),
        targetIds: [dream.dreamId], baseVersions: [textHash], nonce: `n-${Math.random()}`, inputEventId: `e-${Math.random()}`,
      })).receiptId;
      return confirmDream(deps, {
        receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft,
        ownerObservationId: ownerObservation.id,
      });
    };
    const first = confirmOnce();
    const second = confirmOnce();
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.notEqual(first.memoryId, second.memoryId);

    const unconfirmReceipt = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner', proposalId: 'e6-unconfirm', action: 'unconfirm-dream',
      payloadHash: unconfirmDreamPayloadHash({
        confirmId: second.confirmId,
        memoryId: second.memoryId,
        propositionId,
        dreamId: dream.dreamId,
      }),
      targetIds: [second.confirmId], baseVersions: [second.confirmId], nonce: 'nu', inputEventId: 'eu',
    })).receiptId;
    unconfirmDream(deps, {
      receiptId: unconfirmReceipt, confirmId: second.confirmId, memoryId: second.memoryId,
      propositionId, dreamId: dream.dreamId,
    });
    assert.equal(confirmationState(ctx.dream).get(propositionId).valid, true, 'earlier confirm remains valid');
    const compiled = compileRound({ ...deps, mode: 'work', roundId: 'e6-s', tokenizer: conservativeTokens, H: 20000 });
    assert.ok(compiled.eligible_ids.includes(first.memoryId));
    assert.equal(compiled.eligible_ids.includes(second.memoryId), false);

    const voidReceipt = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner', proposalId: 'e6-void', action: 'void-dream',
      payloadHash: voidDreamPayloadHash({ dreamId: dream.dreamId }), targetIds: [dream.dreamId], baseVersions: [dream.dreamId],
      nonce: 'nv', inputEventId: 'ev',
    })).receiptId;
    const voided = voidDream(deps, { receiptId: voidReceipt, dreamId: dream.dreamId });
    assert.equal(voided.ok, true, JSON.stringify(voided));
    const after = compileRound({ ...deps, mode: 'work', roundId: 'e6-s2', tokenizer: conservativeTokens, H: 20000 });
    assert.equal(after.eligible_ids.includes(first.memoryId), false);
    assert.equal(confirmationState(ctx.dream).get(propositionId).valid, false);
  });
});
