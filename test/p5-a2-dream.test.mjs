import assert from 'node:assert/strict';
import test from 'node:test';

import { recordDream } from '../src/dream/store.mjs';
import { confirmDream, dreamConfirmPayloadHash } from '../src/dream/confirm.mjs';
import { selectEligible } from '../src/context/select.mjs';
import { issueReceipt } from '../src/write/owner-actions.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { insertObservation, getMemory } from '../src/storage/repositories.mjs';
import { objectId } from '../src/identity.mjs';
import { createTestContext, makeObservation, mutableClock, registerEntity } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function confirmOne(ctx, { tag, structuredValue = undefined }) {
  const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
  registerEntity(ctx, { id: 'entity:ingredient:scallion', canonical: '葱', alias: '葱' });
  const dream = recordDream(deps, {
    runtime: fakeRuntime({ role: 'dream', callId: `p5a-dream-${tag}` }),
    item: { linkedIds: [], basis: tag, idea: 'i', propositions: [{ text: `命题-${tag}` }] },
  });
  const propositionId = dream.propositionIds[0];
  const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
  const ownerObs = makeObservation(ctx, { messageSeq: 13100 + Math.floor(Math.random() * 500), text: `批准-${tag}` });
  insertObservation(ctx.main, ownerObs);
  const draft = {
    text: `命题-${tag}`, detail: null, why: 'w', type: 'fact', scene: 'work', scope: 'work-only',
    ...(structuredValue === undefined ? {} : { structuredValue }),
    components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: '葱' },
  };
  const payloadHash = dreamConfirmPayloadHash({ dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, evidenceRefs: [], path: 'owner_assertion', ownerObservationId: ownerObs.id });
  const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: `p5a-${tag}`, action: 'confirm-dream',
    payloadHash, targetIds: [dream.dreamId], baseVersions: [textHash], nonce: 'n', inputEventId: `e-${tag}`,
  })).receiptId;
  const confirmed = confirmDream(deps, { receiptId, dreamId: dream.dreamId, propositionId, textHash, candidateDraft: draft, ownerObservationId: ownerObs.id });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  return { dream, confirmed };
}

test('P5/A2: structuredValue 0 survives confirmation; intent task freezes topic', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const { confirmed } = confirmOne(ctx, { tag: 'zero', structuredValue: 0 });
  const candidate = ctx.main.prepare('SELECT structured_value FROM candidates WHERE idempotency_key = ?').get(`confirm:${confirmed.confirmId}`);
  assert.equal(candidate.structured_value, '0', 'zero must not become null');
  const tasks = ctx.main
    .prepare("SELECT payload FROM relations WHERE type = 'dream-confirm-task' AND json_extract(payload, '$.confirmId') = ? ORDER BY commit_seq")
    .all(confirmed.confirmId);
  assert.ok(tasks.length >= 1, 'intent task exists');
  const first = JSON.parse(tasks[0].payload);
  assert.ok(first.topicKey, 'frozen topic key stored in the intent');
});

test('P5/A3: revoked dream source is excluded even without main link/revoke', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const { dream, confirmed } = confirmOne(ctx, { tag: 'void' });
  const dreamMemory = getMemory(ctx.main, objectId('mem', `promote:${confirmed.candidateId}`));
  assert.ok(dreamMemory, 'dream confirmation produced a memory');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_relations_no_delete');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_memories_immutable_columns');
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_memories_binding_immutable');
  ctx.main.prepare('UPDATE memories SET credibility = ? WHERE id = ?').run('verified', dreamMemory.id);
  ctx.main.prepare("DELETE FROM relations WHERE type IN ('dream-confirm-link','dream-revoke')").run();
  ctx.dream.prepare(
    "INSERT INTO relations (id, type, payload, dedupe_key, at, commit_seq, ordinal, event_version, payload_version) VALUES ('void-p5a','dream-void',?, 'void-p5a', ?, (SELECT COALESCE(MAX(commit_seq),0)+1 FROM relations), 0, '2','2')",
  ).run(JSON.stringify({ dreamId: dream.dreamId, reason: 'test' }), ctx.clock.at().at);
  const selected = selectEligible({ main: ctx.main, mode: 'work', dream: ctx.dream });
  assert.equal(selected.items.some((item) => item.id === dreamMemory.id), false, 'voided dream memory must not be eligible');
  const withoutDream = selectEligible({ main: ctx.main, mode: 'work' });
  assert.equal(withoutDream.items.some((item) => item.id === dreamMemory.id), true, 'without dream handle the old chain is still readable');
});
