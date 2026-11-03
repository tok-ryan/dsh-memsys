import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
  getCandidate,
} from '../src/storage/repositories.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { approveDuePolicy, handleOwnerDueCommand, duePayloadHash } from '../src/write/due-actions.mjs';
import { getMemories } from '../src/read/get.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { surfaceDreams } from '../src/dream/surface.mjs';
import { confirmDream, dreamConfirmPayloadHash } from '../src/dream/confirm.mjs';
import { recordCandidates, promoteCandidate } from '../src/write/candidate.mjs';
import { approveSceneExpansion } from '../src/write/candidate.mjs';
import { issueReceipt, sceneExpansionPayloadHash } from '../src/write/owner-actions.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function memoryRow(ctx, { text = '记忆', scene = 'work', scope = 'work-only', keyStatus = 'resolved', bindingStatus = 'accepted', startAt = null, timeState = 'point' } = {}) {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 9900 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p4c-${seq}`, text, why: 'w', type: 'fact', scene, scope });
  Object.assign(candidate, { key_status: keyStatus, binding_status: bindingStatus, binding_basis: '{}', origin_mode: 'self' });
  insertCandidate(ctx.main, candidate);
  const row = makeMemory(ctx, candidate);
  Object.assign(row, { key_status: keyStatus, binding_status: bindingStatus, binding_basis: '{}', origin_mode: 'self', scene, scope });
  insertMemory(ctx.main, row);
  insertTimeline(ctx.main, { memory_id: row.id, start_at: startAt, end_at: timeState === 'exact' ? '2026-07-01T00:00:00Z' : null, prec_start: 'day', prec_end: 'day', time_state: timeState, revision: 1 });
  insertPointer(ctx.main, { memory_id: row.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  return row;
}

test('P4/P4-C E3: shelved-due restore returns to pending-due first', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock, H: 200000 };
  const memory = memoryRow(ctx);
  ctx.main.prepare("UPDATE memories SET due_state = 'shelved-due' WHERE id = ?").run(memory.id);
  ctx.main.prepare("INSERT INTO due_queue (memory_id, due_state, enqueued_seq, enqueued_at, opened_at, deadline_at, revision, reason) VALUES (?, 'shelved-due', 1, ?, NULL, NULL, 0, 'shelve')").run(memory.id, ctx.clock.at().at);
  approveDuePolicy(deps, { policyRevision: 'due-policy-v1' });
  const restored = handleOwnerDueCommand(deps, {
    text: `/mem due-restore ${memory.id} 0`,
    inputEventId: 'e3-restore',
    ownerId: 'owner',
  });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const row = ctx.main.prepare('SELECT due_state, due_done_at FROM memories WHERE id = ?').get(memory.id);
  assert.equal(row.due_state, 'pending-due');
  assert.equal(row.due_done_at, null);
  const queue = ctx.main.prepare('SELECT * FROM due_queue WHERE memory_id = ?').get(memory.id);
  assert.ok(queue.deadline_at);
  assert.equal(Number(queue.enqueued_seq), 2);
});

test('P4/P4-C E12: get reads real binding columns and observation originals', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_memories_binding_required');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_memories_binding_immutable');
  const legacy = memoryRow(ctx);
  ctx.main.prepare('UPDATE memories SET key_status = NULL, binding_status = NULL WHERE id = ?').run(legacy.id);
  const got = getMemories({ main: ctx.main, clock: ctx.clock, ids: [legacy.id] });
  assert.equal(got.status, 'ok');
  assert.equal(got.items[0].group.key_status, 'legacy_binding_unknown');
  assert.equal(got.items[0].group.binding_status, 'legacy_binding_unknown');

  const observation = makeObservation(ctx, { messageSeq: 9950, text: '观察原文' });
  insertObservation(ctx.main, observation);
  const fromObs = getMemories({ main: ctx.main, clock: ctx.clock, ids: [observation.id] });
  assert.equal(fromObs.status, 'ok');
  assert.equal(fromObs.items[0].text, '观察原文');
  assert.equal(fromObs.items[0].kind, 'observation');
});

test('P4/P4-C E13: point events do not match later ranges; evidence_mean only null on zero hits', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const point = memoryRow(ctx, { text: '点事件甲', startAt: '2026-01-01T00:00:00Z', timeState: 'point' });
  memoryRow(ctx, { text: '区间事件乙', startAt: '2026-05-01T00:00:00Z', timeState: 'exact' });
  const later = searchMemories({
    main: ctx.main, clock: ctx.clock, keywords: '点事件',
    timeRange: { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }, maxChars: 8000,
  });
  assert.equal(later.hits.length, 0);
  assert.equal(later.evidence_mean, null);
  const interval = searchMemories({
    main: ctx.main, clock: ctx.clock, keywords: '区间事件',
    timeRange: { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }, maxChars: 8000,
  });
  assert.equal(interval.hits.length, 1);
  assert.equal(typeof interval.evidence_mean, 'number');
});

test('P4/P4-C E14: surface uses current valid confirmations and void state', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
  const linked = memoryRow(ctx, { text: '浮现关联' });
  const dream = recordDream(deps, {
    runtime: fakeRuntime({ role: 'dream', callId: 'e14-dream' }),
    item: { linkedIds: [linked.id], basis: '同一话题', idea: 'i', propositions: [{ text: '命题甲' }, { text: '命题乙' }] },
  });
  const propositionId = dream.propositionIds[0];
  const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
  const ownerObs = makeObservation(ctx, { messageSeq: 9960, text: '主人批准甲' });
  insertObservation(ctx.main, ownerObs);
  const draft = { text: '命题甲', detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only', components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' } };
  const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: 'e14', action: 'confirm-dream',
    payloadHash: dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: ownerObs.id }),
    targetIds: [dream.dreamId], baseVersions: [textHash], nonce: 'n', inputEventId: 'e',
  })).receiptId;
  confirmDream(deps, { receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, ownerObservationId: ownerObs.id });
  const items = surfaceDreams({ main: ctx.main, dream: ctx.dream, clock: ctx.clock, mode: 'work', sessionId: 's1', enabled: true, limit: 5 }).items;
  assert.ok(items.some((item) => item.propositionId === dream.propositionIds[1]), 'unconfirmed proposition surfaces');
  assert.equal(items.some((item) => item.propositionId === propositionId), false, 'confirmed proposition does not surface');
});

test('P4/P4-C E1: owner scene-expansion approval unlocks promotion', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
  const ingested = ingestInput(fakeRuntime({ callId: 'e1c-ingest', messageSeq: 9970 }), { text: '跨场景', messageSeq: 9970 }, deps);
  const created = recordCandidates(fakeRuntime({ callId: 'e1c-cand', requestId: 'e1c-cand' }), {
    items: [{ observationId: ingested.observation.id, text: '跨场景', why: 'w', type: 'fact', scene: 'both', scope: 'global', evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:9' }] }],
  }, deps);
  const candidateId = created.items[0].id;
  const candidate = getCandidate(ctx.main, candidateId);
  const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: 'e1c-approve', action: 'scene-expansion-approval',
    payloadHash: sceneExpansionPayloadHash({ candidateId, payloadHash: candidate.payload_hash }),
    targetIds: [candidateId], baseVersions: [candidate.payload_hash], nonce: 'n', inputEventId: 'e',
  })).receiptId;
  const approved = approveSceneExpansion(deps, { receiptId, candidateId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const promoted = promoteCandidate(fakeRuntime({ callId: 'e1c-promote', requestId: 'e1c-promote' }), candidateId, null, deps);
  assert.equal(promoted.status, 'found');
});
