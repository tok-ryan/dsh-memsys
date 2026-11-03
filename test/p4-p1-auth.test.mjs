import assert from 'node:assert/strict';
import test from 'node:test';

import { getCandidate, insertObservation, countRows } from '../src/storage/repositories.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { recordCandidates, promoteCandidate } from '../src/write/candidate.mjs';
import { recordJudgments } from '../src/write/judgment.mjs';
import { applyMasterVerdict, issueReceipt, masterVerdictPayloadHash } from '../src/write/owner-actions.mjs';
import { createProject, projectCreatePayloadHash } from '../src/write/project.mjs';
import { recordDream } from '../src/dream/store.mjs';
import { confirmDream, dreamConfirmPayloadHash } from '../src/dream/confirm.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';


function issueBound(ctx, { action, targetIds = [], payloadHash, baseVersions = [] }) {
  return withImmediate(ctx.main, () =>
    issueReceipt(ctx.main, ctx.clock, {
      ownerId: 'owner',
      proposalId: `p4-${Math.random().toString(36).slice(2)}`,
      action,
      payloadHash,
      targetIds,
      baseVersions,
      nonce: `n-${Math.random().toString(36).slice(2)}`,
      inputEventId: `e-${Math.random().toString(36).slice(2)}`,
    }),
  ).receiptId;
}

test('P4/P1 E2: owner receipts bind the full payload and base versions', async (t) => {
  await t.test('a verdict approved for A cannot be applied as B', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock };
    const judgment = recordJudgments(
      fakeRuntime({ callId: 'e2-j', requestId: 'e2-j' }),
      { items: [{ verdict_text: '待主人裁决', basis: 'b', falsifier: 'f' }] },
      deps,
    ).items[0];
    const baseHash = ctx.main.prepare('SELECT payload_hash FROM judgments WHERE id = ?').get(judgment.id).payload_hash;
    const receiptId = issueBound(ctx, {
      action: 'master-verdict',
      targetIds: [judgment.id],
      baseVersions: [baseHash],
      payloadHash: masterVerdictPayloadHash({ judgmentId: judgment.id, result: 'right', basis: 'A' }),
    });
    const refused = applyMasterVerdict(ctx.main, ctx.clock, {
      receiptId,
      judgmentId: judgment.id,
      result: 'wrong',
      basis: 'B',
    });
    assert.equal(refused.code, 'receipt_hash_mismatch');
    assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'verdict'").get().n, 0);
  });

  await t.test('a project approved as A cannot be created as B', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const snapshotA = { current_task: null, progress: null, next_action: null, blockers: null };
    const receiptId = issueBound(ctx, {
      action: 'project-create',
      payloadHash: projectCreatePayloadHash({ name: '项目 A', snapshot: snapshotA }),
    });
    const refused = createProject(
      { main: ctx.main, control: ctx.control, clock: ctx.clock },
      { name: '项目 B', receiptId, snapshot: {} },
    );
    assert.equal(refused.code, 'receipt_hash_mismatch');
    assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
  });

  await t.test('a dream draft approved as A cannot be confirmed as B', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const deps = { main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock };
    const dreamResult = recordDream(deps, {
      runtime: fakeRuntime({ role: 'dream', callId: 'e2-dream', requestId: 'e2-dream' }),
      item: { linkedIds: [], basis: 'b', idea: 'i', propositions: [{ text: '命题 A' }] },
    });
    const propositionId = dreamResult.propositionIds[0];
    const textHash = ctx.dream.prepare('SELECT text_hash FROM propositions WHERE id = ?').get(propositionId).text_hash;
    const draftA = {
      text: '草稿 A', detail: null, why: '原因', type: 'fact', scene: 'work', scope: 'work-only',
      components: { entityRef: 'entity:owner', attributeRef: 'food_preference', objectRef: null },
    };
    const draftB = { ...draftA, text: '草稿 B' };
    const receiptId = issueBound(ctx, {
      action: 'confirm-dream',
      targetIds: [dreamResult.dreamId],
      baseVersions: [textHash],
      payloadHash: dreamConfirmPayloadHash({
        dreamId: dreamResult.dreamId,
        propositionId,
        textHash,
        candidateDraft: draftA,
        evidenceRefs: [],
        path: 'owner_assertion',
      }),
    });
    const refused = confirmDream(deps, {
      receiptId,
      dreamId: dreamResult.dreamId,
      propositionId,
      textHash,
      candidateDraft: draftB,
    });
    assert.equal(refused.code, 'receipt_hash_mismatch');
    assert.equal(ctx.dream.prepare('SELECT COUNT(*) AS n FROM confirmation_snapshots').get().n, 0);
    assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'dream'").get().n, 0);
  });
});

test('P4/P1 E1: promotion re-checks scene expansion approval', async (t) => {
  await t.test('a pending both/global candidate cannot be promoted without approval', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const runtime = fakeRuntime({ callId: 'e1-ingest', requestId: 'e1-ingest' });
    const ingested = ingestInput(runtime, { text: '想两边都看', messageSeq: 9001 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
    const created = recordCandidates(
      fakeRuntime({ callId: 'e1-cand', requestId: 'e1-cand' }),
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '想两边都看',
            why: '跨场景',
            type: 'fact',
            scene: 'both',
            scope: 'global',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:15' }],
          },
        ],
      },
      { main: ctx.main, control: ctx.control, clock: ctx.clock },
    );
    const candidateId = created.items[0].id;
    assert.equal(getCandidate(ctx.main, candidateId).status, 'pending');

    assert.throws(
      () =>
        promoteCandidate(
          fakeRuntime({ callId: 'e1-promote', requestId: 'e1-promote' }),
          candidateId,
          null,
          { main: ctx.main, control: ctx.control, clock: ctx.clock },
        ),
      (err) => err.code === 'invalid_transition' && /scene_expansion/.test(JSON.stringify(err.detail ?? {})),
    );
    assert.equal(countRows(ctx.main, 'memories'), 0, 'no memory may be created before approval');
  });

  await t.test('a same-window candidate still promotes normally', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    t.after(() => ctx.cleanup());
    const ingested = ingestInput(fakeRuntime({ callId: 'e1-ingest-2' }), { text: '只在工作里', messageSeq: 9002 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
    const created = recordCandidates(
      fakeRuntime({ callId: 'e1-cand-2', requestId: 'e1-cand-2' }),
      {
        items: [
          {
            observationId: ingested.observation.id,
            text: '只在工作里',
            why: '本窗口',
            type: 'fact',
            scene: 'work',
            scope: 'work-only',
            evidenceRefs: [{ observationId: ingested.observation.id, sourceSpan: 'bytes:0:15' }],
          },
        ],
      },
      { main: ctx.main, control: ctx.control, clock: ctx.clock },
    );
    const result = promoteCandidate(
      fakeRuntime({ callId: 'e1-promote-2', requestId: 'e1-promote-2' }),
      created.items[0].id,
      null,
      { main: ctx.main, control: ctx.control, clock: ctx.clock },
    );
    assert.equal(result.status, 'found');
    assert.equal(countRows(ctx.main, 'memories'), 1);
  });
});
