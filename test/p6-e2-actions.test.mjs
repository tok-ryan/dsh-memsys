import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProject,
  selectProject,
  updateProject,
  completeProject,
  projectCreatePayloadHash,
  projectSelectPayloadHash,
  projectCompletePayloadHash,
} from '../src/write/project.mjs';
import { approveSceneExpansion } from '../src/write/candidate.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { confirmDream, dreamConfirmPayloadHash } from '../src/dream/confirm.mjs';
import { issueReceipt, consumeReceipt } from '../src/write/owner-actions.mjs';
import { payloadHash } from '../src/identity.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { insertObservation, getCandidate } from '../src/storage/repositories.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { recordCandidates } from '../src/write/candidate.mjs';
import { sceneExpansionPayloadHash } from '../src/write/owner-actions.mjs';
import { createTestContext, makeObservation, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function depsOf(ctx, extra = {}) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock, ...extra };
}

function receipt(ctx, payloadHash, action, targetIds = [], baseVersions = []) {
  return withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: 'p6-' + Math.random(), action,
    payloadHash, targetIds, baseVersions, nonce: 'n', inputEventId: 'e',
  })).receiptId;
}

function consumeAfterReserve(ctx, receiptId) {
  return { afterReserve: () => consumeReceipt(ctx.main, ctx.clock, receiptId) };
}

test('P6/E2 project create: lock-internal second read rejects consumed receipt', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const name = 'p6-create';
  const snapshot = { current_task: 't', progress: null, next_action: null, blockers: null };
  const receiptId = receipt(ctx, projectCreatePayloadHash({ name, snapshot }), 'project-create');
  const created = createProject(depsOf(ctx, { commitHooks: consumeAfterReserve(ctx, receiptId) }), { name, receiptId, snapshot });
  assert.equal(created.ok, false);
  assert.equal(created.code, 'receipt_already_consumed');
});

function seedProject(ctx) {
  const name = 'p6-chain';
  const snapshot = { current_task: 't', progress: null, next_action: null, blockers: null };
  const createReceipt = receipt(ctx, projectCreatePayloadHash({ name, snapshot }), 'project-create');
  const created = createProject(depsOf(ctx), { name, receiptId: createReceipt, snapshot });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { projectId: created.projectId, snapshot };
}

test('P6/E2 project select: lock-internal second read rejects consumed receipt', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const { projectId } = seedProject(ctx);
  const selectReceipt = receipt(ctx, projectSelectPayloadHash({ projectId, revision: 1, sessionId: 's' }), 'project-select', [projectId], [1]);
  const selected = selectProject(depsOf(ctx, { commitHooks: consumeAfterReserve(ctx, selectReceipt) }), { projectId, sessionId: 's', receiptId: selectReceipt });
  assert.equal(selected.code, 'receipt_already_consumed');
});

test('P6/E2 project update: lock-internal second read rejects consumed receipt', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const { projectId } = seedProject(ctx);
  const updateReceipt = receipt(ctx, payloadHash({ projectId, patch: { current_task: 'u' } }), 'project-update', [projectId], [1]);
  const updated = updateProject(depsOf(ctx, { commitHooks: consumeAfterReserve(ctx, updateReceipt) }), { projectId, patch: { current_task: 'u' }, receiptId: updateReceipt, baseRevision: 1 });
  assert.equal(updated.code, 'receipt_already_consumed');
});

test('P6/E2 project complete: lock-internal second read rejects consumed receipt', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const { projectId, snapshot } = seedProject(ctx);
  const completeReceipt = receipt(ctx, projectCompletePayloadHash({ projectId, revision: 1, snapshotHash: payloadHash(snapshot) }), 'project-complete', [projectId], [1]);
  const completed = completeProject(depsOf(ctx, { commitHooks: consumeAfterReserve(ctx, completeReceipt) }), { projectId, receiptId: completeReceipt });
  assert.equal(completed.code, 'receipt_already_consumed');
});

test('P6/E2 scene-expansion approval revalidates inside its lock', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  const ingested = ingestInput(fakeRuntime({ callId: 'p6-scene', messageSeq: 18001 }), { text: '跨场景', messageSeq: 18001 }, depsOf(ctx));
  const created = recordCandidates(fakeRuntime({ callId: 'p6-scene-cand', requestId: 'p6-scene-cand' }), {
    items: [{ observationId: ingested.observation.id, text: '跨场景', why: 'w', type: 'fact', scene: 'both', scope: 'global', evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:9' }] }],
  }, depsOf(ctx));
  const candidateId = created.items[0].id;
  const candidate = getCandidate(ctx.main, candidateId);
  const receiptId = receipt(ctx, sceneExpansionPayloadHash({ candidateId, payloadHash: candidate.payload_hash }), 'scene-expansion-approval', [candidateId], [candidate.payload_hash]);
  const approved = approveSceneExpansion(depsOf(ctx, { beforeReceiptGate: () => consumeReceipt(ctx.main, ctx.clock, receiptId) }), { receiptId, candidateId });
  assert.equal(approved.code, 'receipt_already_consumed');
});

test('P6/E2 dream confirm revalidates in the main lock', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  const deps = depsOf(ctx, { dream: ctx.dream });
  const dream = recordDream(deps, {
    runtime: fakeRuntime({ role: 'dream', callId: 'p6-confirm' }),
    item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '命题' }] },
  });
  const propositionId = dream.propositionIds[0];
  const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
  const ownerObs = makeObservation(ctx, { messageSeq: 18002, text: '批准' });
  insertObservation(ctx.main, ownerObs);
  const draft = { text: '命题', detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only', components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' } };
  const receiptId = receipt(ctx, dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: ownerObs.id }), 'confirm-dream', [dream.dreamId], [textHash]);
  const confirmed = confirmDream(depsOf(ctx, { dream: ctx.dream, commitHooks: consumeAfterReserve(ctx, receiptId) }), {
    receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, ownerObservationId: ownerObs.id,
  });
  assert.equal(confirmed.code, 'receipt_already_consumed');
});
