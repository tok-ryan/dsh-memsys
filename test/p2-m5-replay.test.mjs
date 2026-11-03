import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { openAll, closeAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll, migrateDatabase } from '../src/storage/migrate.mjs';
import {
  appendRelation,
  countRows,
  insertCandidate,
  insertCandidateEntity,
  insertObservation,
  insertRelation,
  listRelations,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import {
  assertKnownEventVersionsOrQuarantine,
  foldJudgmentVerdicts,
  legacyAudit,
  normalizeLegacyRelation,
  replayMain,
  selfNoteStatuses,
} from '../src/storage/replay.mjs';
import { canonicalJson, payloadHash } from '../src/identity.mjs';
import { recordCandidates } from '../src/write/candidate.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { recordSelfNotes } from '../src/write/self-note.mjs';
import { recordJudgments, recordVerdict } from '../src/write/judgment.mjs';
import { handleOwnerDueCommand, duePayloadHash } from '../src/write/due-actions.mjs';
import { scanReviews } from '../src/write/review.mjs';
import {
  createTestContext,
  makeCandidate,
  makeObservation,
  mutableClock,
} from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

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

function openPartial(clock, limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p2m5-'));
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  const migrations = discoverMigrations();
  for (const db of ['main', 'control', 'dream']) {
    migrateDatabase(
      handles[db],
      db,
      migrations[db].filter((migration) => migration.version <= limits[db]),
      clock,
    );
  }
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
    config,
    handles,
    main: handles.main,
    control: handles.control,
    clock,
    cleanup() {
      closeAll(handles);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('P2-M5 four-event idempotency matrix', async (t) => {
  await t.test('due-state v2: replay returns the original id, changed payload conflicts', () => {
    const ctx = withContext(t);
    const at = ctx.clock.at().at;
    const businessKey = canonicalJson(['mem_due_x', 'op-1', 0]);
    const payload = {
      memoryId: 'mem_due_x',
      baseRevision: 0,
      revision: 1,
      from: 'pending-due',
      to: 'open',
      reason: 'owner_confirm',
      evidence_refs: [],
      policyRevision: 'due-policy-v1',
      receiptId: 'rcpt-1',
      triggerId: 'evt-1',
      reportId: 'report-1',
      dueProjection: { ownerIdentity: 'owner', enqueued_seq: 1 },
    };
    const first = withImmediate(ctx.main, () =>
      appendRelation(ctx.main, {
        type: 'due-state', payload, businessKey, at,
        keyEncoding: 'canonical', eventVersion: '2', payloadVersion: '2',
      }),
    );
    const replay = withImmediate(ctx.main, () =>
      appendRelation(ctx.main, {
        type: 'due-state', payload, businessKey, at,
        keyEncoding: 'canonical', eventVersion: '2', payloadVersion: '2',
      }),
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.id, first.id);
    assert.throws(
      () =>
        withImmediate(ctx.main, () =>
          appendRelation(ctx.main, {
            type: 'due-state',
            payload: { ...payload, to: 'done' },
            businessKey,
            at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          }),
        ),
      (err) => err.code === 'idempotency_conflict',
    );
    const stored = ctx.main.prepare("SELECT * FROM relations WHERE dedupe_key = ?").get(canonicalJson(['due-state', businessKey]));
    assert.equal(stored.event_version, '2');
    const eventCount = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'due-state'").get();
    assert.equal(Number(eventCount.n), 1);
  });

  await t.test('candidate-entity v2 is written with bytes and a stable key', () => {
    const ctx = withContext(t);
    const observation = makeObservation(ctx, { messageSeq: 7001, text: '我不喜欢刺角瓜。' });
    insertObservation(ctx.main, observation);
    const request = {
      items: [
        {
          observationId: observation.id,
          text: '不喜欢刺角瓜',
          why: '口味',
          type: 'preference',
          evidenceRefs: [{ observationId: observation.id, sourceSpan: 'bytes:3:21' }],
          entityMention: { sourceSpan: 'bytes:12:21' },
        },
      ],
    };
    recordCandidates(rt('ce-1'), request, depsOf(ctx));
    const again = recordCandidates(rt('ce-1'), request, depsOf(ctx));
    assert.equal(again.items[0].replayed, true);
    const events = ctx.main.prepare("SELECT * FROM relations WHERE type = 'candidate-entity'").all();
    assert.equal(events.length, 1);
    const payload = JSON.parse(events[0].payload);
    assert.equal(payload.scopeId, 'work');
    assert.equal(typeof payload.originalBytesBase64, 'string');
    assert.ok(payload.evidenceHash);
    assert.equal(events[0].event_version, '2');
    const row = ctx.main.prepare('SELECT * FROM candidate_entity_registry').get();
    assert.equal(row.id, payload.candidateEntityId);
  });

  await t.test('review-defer v2 fires once per review item', () => {
    const ctx = withContext(t);
    const judgment = recordJudgments(rt('rd-j'), { items: [{ verdict_text: '待复核', basis: 'b', falsifier: 'f' }] }, depsOf(ctx)).items[0];
    recordSelfNotes(rt('rd-n'), { items: [{ text: '反思', reason: 'r', reflection_judgment_ids: [judgment.id] }] }, depsOf(ctx));
    ctx.main.prepare('UPDATE review_queue SET deadline_at = ? WHERE object_id = ?').run('2000-01-01T00:00:00.000Z', judgment.id);
    const first = scanReviews(rt('rd-scan'), 0, depsOf(ctx));
    assert.ok(first.deferred >= 1);
    const second = scanReviews(rt('rd-scan-2'), 0, depsOf(ctx));
    assert.equal(second.deferred, 0);
    const events = ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'review-defer'").get();
    assert.equal(Number(events.n), 1);
    const row = ctx.main.prepare("SELECT * FROM relations WHERE type = 'review-defer'").get();
    const payload = JSON.parse(row.payload);
    assert.equal(payload.reviewId, ctx.main.prepare("SELECT id FROM review_queue WHERE object_id = ?").get(judgment.id).id);
    assert.equal(row.event_version, '2');
  });

  await t.test('shelve v2 carries target, reason, receipt and review id; repeats are no-ops', () => {
    const ctx = withContext(t);
    // A plain trusted input becomes a capture candidate with its own review row.
    const ingested = ingestInput(fakeRuntime({ callId: 'shelve-c', requestId: 'shelve-c' }), { text: '今天天气不错。', messageSeq: 7002 }, depsOf(ctx));
    const capture = ctx.main.prepare('SELECT * FROM candidates WHERE id = ?').get(ingested.capture.id);
    assert.ok(capture);
    ctx.main
      .prepare("UPDATE review_queue SET deadline_at = '2000-01-01T00:00:00.000Z' WHERE object_id = ?")
      .run(capture.id);
    scanReviews(rt('shelve-s1'), 0, depsOf(ctx));
    scanReviews(rt('shelve-s2'), 0, depsOf(ctx));
    const events = ctx.main.prepare("SELECT * FROM relations WHERE type = 'shelve'").all();
    assert.equal(events.length, 1);
    const payload = JSON.parse(events[0].payload);
    assert.equal(payload.targetType, 'candidate');
    assert.equal(payload.targetId, capture.id);
    assert.equal(payload.reason, 'raw_capture_unreviewed');
    assert.equal(payload.receiptId, null);
    const queueRow = ctx.main.prepare('SELECT id FROM review_queue WHERE object_id = ?').get(capture.id);
    assert.equal(payload.reviewId, queueRow.id);
    assert.equal(events[0].event_version, '2');
  });
});

test('P2-M5 legacy events stay byte-identical and never get rewritten', async (t) => {
  await t.test('first-batch rows survive migration and are adapted read-only', () => {
    const clock = mutableClock().clock;
    const ctx = openPartial(clock, { main: 3, control: 2, dream: 1 });
    try {
      const observation = makeObservation(ctx, { messageSeq: 8001, text: '旧原话' });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation, { businessKey: 'legacy-c1' });
      // The legacy database predates main-007, so the row has no binding columns.
      delete candidate.key_status;
      delete candidate.binding_status;
      delete candidate.binding_basis;
      delete candidate.origin_mode;
      insertCandidate(ctx.main, candidate);
      insertCandidateEntity(ctx.main, {
        id: 'ce_legacy_1',
        observation_id: observation.id,
        source_span: 'bytes:0:6',
        original_bytes: Buffer.from('旧原话', 'utf8'),
        evidence_refs: '[]',
        scope_id: 'work',
        rule_revision: 'ce-v1',
        status: 'candidate',
        at: clock.at().at,
        payload_hash: payloadHash({ legacy: true }),
      });
      const at = clock.at().at;
      // Old v1 due-state key/payload shape (no baseRevision/policy/report).
      insertRelation(ctx.main, {
        id: 'rel_legacy_due',
        type: 'due-state',
        payload: { memoryId: 'mem_legacy', from: 'pending-due', to: 'shelved-due', reason: 'cap-100' },
        dedupeKey: 'due-state:mem_legacy:cap-100:1',
        at,
        commitSeq: 1,
        eventVersion: '1',
        payloadVersion: '1',
      });
      // Old v1 shelve shape.
      insertRelation(ctx.main, {
        id: 'rel_legacy_shelve',
        type: 'shelve',
        payload: { targetId: candidate.id, reason: 'raw_capture_unreviewed', receiptId: null },
        dedupeKey: `shelve:${candidate.id}:raw_capture_unreviewed`,
        at,
        commitSeq: 2,
        eventVersion: '1',
        payloadVersion: '1',
      });
      const before = listRelations(ctx.main).map((row) => canonicalJson(row));

      migrateAll(ctx.handles, { clock });
      const after = listRelations(ctx.main).map((row) => canonicalJson(row));
      assert.deepEqual(after, before, 'old relation rows must not change during migration');

      const audit = legacyAudit(ctx.main);
      assert.ok(audit.v1 >= 2, `expected legacy rows, got ${audit.v1}`);
      assert.ok(audit.legacy_missing.some((entry) => entry.type === 'due-state' && entry.missing.includes('baseRevision')));
      assert.ok(audit.legacy_missing.some((entry) => entry.type === 'shelve' && entry.missing.includes('targetType')));
      assert.deepEqual(audit.candidate_entity_row_without_event, ['ce_legacy_1']);

      const due = normalizeLegacyRelation(ctx.main.prepare("SELECT * FROM relations WHERE id = 'rel_legacy_due'").get());
      assert.equal(due.normalized.revision, 1);
      assert.equal(due.normalized.baseRevision, 0);

      const replay = replayMain(ctx.main);
      assert.ok(replay.relations >= 2);
      assert.equal(
        ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE event_version = '2'").get().n,
        0,
        'no fabricated v2 events for legacy rows',
      );
      t.diagnostic('P2_M5_OK matrix=4 legacy_bytes_unchanged=true legacy_adapter=report_only');
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('unknown event versions are quarantined, not skipped', () => {
    const ctx = withContext(t);
    insertRelation(ctx.main, {
      id: 'rel_unknown_version',
      type: 'due-state',
      payload: { memoryId: 'x' },
      dedupeKey: 'due-state:x:unknown:9',
      at: ctx.clock.at().at,
      commitSeq: 1,
      eventVersion: '9',
      payloadVersion: '9',
    });
    const quarantine = assertKnownEventVersionsOrQuarantine(listRelations(ctx.main));
    assert.equal(quarantine.ok, false);
    assert.equal(quarantine.version, '9');
  });
});
