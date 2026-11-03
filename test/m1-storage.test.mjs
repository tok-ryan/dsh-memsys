import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { openDatabase, pragmaValue, withImmediate, withSavepoint } from '../src/storage/open.mjs';
import { migrateAll, migrateDatabase, discoverMigrations, MigrationError } from '../src/storage/migrate.mjs';
import {
  countRows,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertMemory,
  insertObservation,
  insertRelation,
  nextCommitSeq,
} from '../src/storage/repositories.mjs';
import { foldMemoryState, foldCandidateStatus, replayMain } from '../src/storage/replay.mjs';
import { backupAll, backupCapability, restoreToIsolated } from '../src/storage/backup.mjs';
import { readExactObservation } from '../src/control/readback.mjs';
import { commitControlled } from '../src/control/commit.mjs';
import { reserveAttempt, completeAttempt, ControlError } from '../src/control/ledger.mjs';
import { objectKey } from '../src/identity.mjs';
import { createTestContext, fixedClock, makeCandidate, makeMemory, makeObservation } from './helpers/fixtures.mjs';
import { closedControl, countCalls, unknownReader } from './helpers/faults.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function latestVersions() {
  const migrations = discoverMigrations();
  const pick = (db) => Math.max(...migrations[db].map((migration) => migration.version));
  return { main: pick('main'), control: pick('control'), dream: pick('dream') };
}

function tables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function observationSpec(logicalId, requestKey = `op:${logicalId}`) {
  return {
    objectKey: objectKey('main', logicalId),
    targetDb: 'main',
    requestKey,
    payloadHash: 'payload-hash-1',
    immutablePayload: '{"probe":1}',
    targetIds: [logicalId],
  };
}

test('M1 storage baseline', async (t) => {
  await t.test('migrations create the expected schema in all three databases', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      // Legacy (batch-1) tables must exist; later migrations may add more.
      const mainTables = tables(ctx.main);
      for (const name of [
        'candidate_entity_registry',
        'candidates',
        'config',
        'due_queue',
        'evidence',
        'injections',
        'memories',
        'observations',
        'origins',
        'pointers',
        'relations',
        'review_queue',
        'schema_migrations',
        'state',
        'timeline',
        'uses',
      ]) {
        assert.ok(mainTables.includes(name), `main missing ${name}`);
      }
      const controlTables = tables(ctx.control);
      for (const name of [
        'capacity_rounds',
        'compilations',
        'context_snapshots',
        'control_events',
        'deliveries',
        'object_streams',
        'operation_attempts',
        'operations',
        'schema_migrations',
        'snapshot_groups',
        'snapshot_items',
      ]) {
        assert.ok(controlTables.includes(name), `control missing ${name}`);
      }
      // Dream database is a placeholder only: no dream content tables.
      const dreamTables = tables(ctx.dream);
      assert.ok(dreamTables.includes('db_marker'));
      assert.ok(dreamTables.includes('schema_migrations'));
      const versions = {};
      for (const label of ['main', 'control', 'dream']) {
        versions[label] = Number(
          ctx.handles[label].prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,
        );
      }
      assert.deepEqual(versions, latestVersions());
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('a second migration run applies nothing and keeps versions stable', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const before = countRows(ctx.main, 'schema_migrations');
      const again = migrateAll(ctx.handles, { clock: fixedClock() });
      assert.deepEqual(again.versions, latestVersions());
      assert.deepEqual(again.results.main.appliedNow, []);
      assert.deepEqual(again.results.control.appliedNow, []);
      assert.deepEqual(again.results.dream.appliedNow, []);
      assert.equal(countRows(ctx.main, 'schema_migrations'), before);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('a changed migration checksum is refused', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const migrations = discoverMigrations();
      const tampered = migrations.main.map((migration) =>
        migration.version === 1 ? { ...migration, checksum: 'deadbeef' } : migration,
      );
      assert.throws(
        () => migrateDatabase(ctx.main, 'main', tampered, fixedClock()),
        (err) => err instanceof MigrationError && err.code === 'migration_checksum_mismatch',
      );
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('an unknown future schema version is refused instead of downgraded', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const migrations = discoverMigrations().main.filter((migration) => migration.version === 1);
      assert.throws(
        () => migrateDatabase(ctx.main, 'main', migrations, fixedClock()),
        (err) => err instanceof MigrationError && err.code === 'schema_from_future',
      );
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('connection profile uses WAL, foreign keys, FULL sync and bounded busy timeout', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      for (const db of [ctx.main, ctx.control, ctx.dream]) {
        assert.equal(String(pragmaValue(db, 'journal_mode')).toLowerCase(), 'wal');
        assert.equal(Number(pragmaValue(db, 'foreign_keys')), 1);
        assert.equal(Number(pragmaValue(db, 'synchronous')), 2);
        assert.equal(Number(pragmaValue(db, 'busy_timeout')), 5000);
        assert.equal(pragmaValue(db, 'integrity_check'), 'ok');
        assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
      }
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('observations and evidence are append-only at the database level', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const observation = makeObservation(ctx, { messageSeq: 1 });
      insertObservation(ctx.main, observation);
      assert.throws(
        () => ctx.main.prepare('UPDATE observations SET text = ? WHERE id = ?').run('改了', observation.id),
        /observations_append_only/,
      );
      assert.throws(
        () => ctx.main.prepare('DELETE FROM observations WHERE id = ?').run(observation.id),
        /observations_append_only/,
      );

      const candidate = makeCandidate(ctx, observation);
      insertCandidate(ctx.main, candidate);
      insertEvidence(ctx.main, {
        id: 'ev_candidate_1',
        memory_id: null,
        candidate_id: candidate.id,
        observation_id: observation.id,
        source_memory_id: null,
        role: 'basis',
        source_span: 'bytes:0:12',
        at: ctx.clock.at().at,
      });
      assert.throws(
        () => ctx.main.prepare('UPDATE evidence SET role = ? WHERE id = ?').run('derived', 'ev_candidate_1'),
        /evidence_append_only/,
      );
      // Exactly one parent on each side is enforced.
      assert.throws(
        () =>
          insertEvidence(ctx.main, {
            id: 'ev_bad',
            memory_id: null,
            candidate_id: null,
            observation_id: observation.id,
            source_memory_id: null,
            role: 'basis',
            source_span: 'bytes:0:1',
            at: ctx.clock.at().at,
          }),
        /CHECK constraint failed|constraint/i,
      );
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('candidate rows only allow status/projection updates', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const observation = makeObservation(ctx, { messageSeq: 2 });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation);
      insertCandidate(ctx.main, candidate);
      assert.throws(
        () => ctx.main.prepare('UPDATE candidates SET text = ? WHERE id = ?').run('换个说法', candidate.id),
        /candidates_immutable_column/,
      );
      ctx.main
        .prepare('UPDATE candidates SET status = ?, promoted_at = ? WHERE id = ?')
        .run('promoted', ctx.clock.at().at, candidate.id);
      const row = ctx.main.prepare('SELECT status FROM candidates WHERE id = ?').get(candidate.id);
      assert.equal(row.status, 'promoted');
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('memory rows only allow due projections and cannot be deleted', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const observation = makeObservation(ctx, { messageSeq: 3 });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation);
      insertCandidate(ctx.main, candidate);
      const memory = makeMemory(ctx, candidate);
      insertMemory(ctx.main, memory);
      assert.throws(
        () => ctx.main.prepare('UPDATE memories SET text = ? WHERE id = ?').run('x', memory.id),
        /memories_immutable_column/,
      );
      ctx.main.prepare('UPDATE memories SET due_state = ? WHERE id = ?').run('pending-due', memory.id);
      assert.equal(
        ctx.main.prepare('SELECT due_state FROM memories WHERE id = ?').get(memory.id).due_state,
        'pending-due',
      );
      assert.throws(
        () => ctx.main.prepare('DELETE FROM memories WHERE id = ?').run(memory.id),
        /memories_not_deletable/,
      );
      // promoted_from is unique: one candidate promotes at most once.
      const second = makeMemory(ctx, candidate, { businessKey: 'promote:dup' });
      assert.throws(() => insertMemory(ctx.main, second), /UNIQUE constraint failed|promoted_from/i);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('foreign keys are enforced for candidate parents', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const observation = makeObservation(ctx, { messageSeq: 4 });
      insertObservation(ctx.main, observation);
      const orphan = makeCandidate(ctx, observation, { businessKey: 'capture:orphan' });
      orphan.observation_id = 'obs_missing';
      assert.throws(() => insertCandidate(ctx.main, orphan), /FOREIGN KEY constraint failed/i);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('SAVEPOINT rolls back only the nested unit', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const observation = makeObservation(ctx, { messageSeq: 5 });
      withImmediate(ctx.main, () => {
        insertObservation(ctx.main, observation);
        assert.throws(() =>
          withSavepoint(ctx.main, 'sp_candidate', () => {
            insertCandidate(ctx.main, makeCandidate(ctx, observation));
            throw new Error('boom after candidate insert');
          }),
        );
      });
      assert.equal(countRows(ctx.main, 'observations'), 1);
      assert.equal(countRows(ctx.main, 'candidates'), 0);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('relations are append-only, deduplicated and monotonic', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      insertRelation(ctx.main, {
        id: 'rel_1',
        type: 'timeline-change',
        payload: { memoryId: 'mem_x', to: 'ongoing' },
        dedupeKey: 'timeline-change:memory:mem_x:1',
        at: ctx.clock.at().at,
        commitSeq: nextCommitSeq(ctx.main),
      });
      insertRelation(ctx.main, {
        id: 'rel_2',
        type: 'timeline-change',
        payload: { memoryId: 'mem_x', to: 'ended_unknown' },
        dedupeKey: 'timeline-change:memory:mem_x:2',
        at: ctx.clock.at().at,
        commitSeq: nextCommitSeq(ctx.main),
      });
      const rows = ctx.main
        .prepare("SELECT commit_seq FROM relations WHERE type = 'timeline-change' ORDER BY commit_seq")
        .all()
        .map((row) => row.commit_seq);
      assert.equal(rows.length, 2);
      assert.ok(rows[1] > rows[0], `commit_seq must increase: ${rows.join(',')}`);
      assert.throws(
        () =>
          insertRelation(ctx.main, {
            id: 'rel_dup',
            type: 'timeline-change',
            payload: { memoryId: 'mem_x', to: 'x' },
            dedupeKey: 'timeline-change:memory:mem_x:1',
            at: ctx.clock.at().at,
            commitSeq: 3,
          }),
        /UNIQUE constraint failed/i,
      );
      assert.throws(
        () => ctx.main.prepare("UPDATE relations SET type = 'x' WHERE id = 'rel_1'").run(),
        /relations_append_only/,
      );
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('replay folds terminal memory states ahead of supersede', () => {
    const relations = [
      { type: 'supersede', payload: JSON.stringify({ oldId: 'm1', newId: 'm2' }), commit_seq: 1, ordinal: 0 },
      { type: 'demote', payload: JSON.stringify({ targetId: 'm1' }), commit_seq: 2, ordinal: 0 },
    ];
    assert.equal(foldMemoryState(relations, 'm1'), 'retired');
    assert.equal(foldMemoryState([relations[0]], 'm1'), 'superseded');
    assert.equal(foldMemoryState([], 'm1'), 'active');
    const candidates = [
      { type: 'promote', payload: JSON.stringify({ candidateId: 'c1' }), commit_seq: 1, ordinal: 0 },
      { type: 'supersede', payload: JSON.stringify({ oldId: 'x', newId: 'y' }), commit_seq: 2, ordinal: 0 },
    ];
    assert.equal(foldCandidateStatus(candidates, 'c1'), 'promoted');
    assert.equal(foldCandidateStatus(candidates, 'c2'), 'pending');
  });

  await t.test('registry seed writes a config projection and a config-change relation', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const registry = ctx.main.prepare("SELECT value FROM config WHERE key = 'registry'").get();
      const parsed = JSON.parse(registry.value);
      assert.equal(parsed.revision, '1');
      assert.ok(parsed.entity_registry.some((entry) => entry.id === 'entity:owner'));
      const events = ctx.main.prepare("SELECT type FROM relations WHERE type = 'config-change'").all();
      assert.equal(events.length, 1);
      const replay = replayMain(ctx.main);
      assert.equal(replay.relations, 1);
    } finally {
      ctx.cleanup();
    }
  });
});

test('M1 controlled ledger and readback', async (t) => {
  await t.test('reserve pre-deducts, blocks a second in-flight attempt and freezes on the third failure', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const spec = observationSpec('obs_ledger_1');
      const first = reserveAttempt(ctx.control, ctx.clock, spec);
      assert.equal(first.consecutiveFailures, 1);
      assert.equal(first.frozen, false);
      assert.throws(
        () => reserveAttempt(ctx.control, ctx.clock, spec),
        (err) => err instanceof ControlError && err.code === 'object_inflight',
      );
      completeAttempt(ctx.control, ctx.clock, {
        objectKey: spec.objectKey,
        operationId: first.operationId,
        generation: first.generation,
        attemptNo: first.attemptNo,
        result: 'unknown',
        error: 'simulated',
      });

      const second = reserveAttempt(ctx.control, ctx.clock, spec);
      assert.equal(second.consecutiveFailures, 2);
      completeAttempt(ctx.control, ctx.clock, {
        objectKey: spec.objectKey,
        operationId: second.operationId,
        generation: second.generation,
        attemptNo: second.attemptNo,
        result: 'unknown',
        error: 'simulated',
      });

      const third = reserveAttempt(ctx.control, ctx.clock, spec);
      assert.equal(third.consecutiveFailures, 3);
      const state = completeAttempt(ctx.control, ctx.clock, {
        objectKey: spec.objectKey,
        operationId: third.operationId,
        generation: third.generation,
        attemptNo: third.attemptNo,
        result: 'unknown',
        error: 'simulated',
      });
      assert.equal(state.frozen, true);
      assert.throws(
        () => reserveAttempt(ctx.control, ctx.clock, spec),
        (err) => err instanceof ControlError && err.code === 'object_frozen',
      );
      const attempts = ctx.control
        .prepare('SELECT phase, count(*) AS n FROM operation_attempts GROUP BY phase')
        .all();
      const byPhase = Object.fromEntries(attempts.map((row) => [row.phase, Number(row.n)]));
      assert.deepEqual(byPhase, { complete: 3, reserve: 3 });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('a third attempt that reads found clears the failure counter', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const spec = observationSpec('obs_ledger_2');
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const reservation = reserveAttempt(ctx.control, ctx.clock, spec);
        completeAttempt(ctx.control, ctx.clock, {
          objectKey: spec.objectKey,
          operationId: reservation.operationId,
          generation: reservation.generation,
          attemptNo: reservation.attemptNo,
          result: 'unknown',
        });
      }
      const third = reserveAttempt(ctx.control, ctx.clock, spec);
      const state = completeAttempt(ctx.control, ctx.clock, {
        objectKey: spec.objectKey,
        operationId: third.operationId,
        generation: third.generation,
        attemptNo: third.attemptNo,
        result: 'found',
      });
      assert.equal(state.frozen, false);
      const operation = ctx.control
        .prepare('SELECT consecutive_failures FROM operations WHERE operation_id = ?')
        .get(third.operationId);
      assert.equal(Number(operation.consecutive_failures), 0);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('commitControlled reports found and resets failures', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const row = makeObservation(ctx, { messageSeq: 11 });
      const spec = observationSpec(row.id);
      const receipt = commitControlled({
        control: ctx.control,
        clock: ctx.clock,
        spec,
        writeTxn: () => insertObservation(ctx.main, row),
        readExact: () => readExactObservation(ctx.main, row),
      });
      assert.equal(receipt.status, 'found');
      assert.deepEqual(receipt.attempts, [1]);
      assert.equal(receipt.frozen, false);
      assert.equal(getObservation(ctx.main, row.id).text, row.text);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('missing readback triggers exactly one idempotent repair write', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const row = makeObservation(ctx, { messageSeq: 12 });
      const spec = observationSpec(row.id);
      const writeTxn = countCalls(() => {
        // Simulates a commit that silently did not land.
      });
      const repairTxn = countCalls(() => {
        if (!getObservation(ctx.main, row.id)) insertObservation(ctx.main, row);
      });
      const receipt = commitControlled({
        control: ctx.control,
        clock: ctx.clock,
        spec,
        writeTxn,
        repairTxn,
        readExact: () => readExactObservation(ctx.main, row),
      });
      assert.equal(writeTxn.calls, 1);
      assert.equal(repairTxn.calls, 1);
      assert.equal(receipt.status, 'found');
      assert.deepEqual(receipt.attempts, [1, 2]);
      assert.equal(getObservation(ctx.main, row.id).text, row.text);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('unknown readback is never reported as missing and does not fake success', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const row = makeObservation(ctx, { messageSeq: 13 });
      const spec = observationSpec(row.id);
      const receipt = commitControlled({
        control: ctx.control,
        clock: ctx.clock,
        spec,
        writeTxn: () => insertObservation(ctx.main, row),
        repairTxn: () => {
          if (!getObservation(ctx.main, row.id)) insertObservation(ctx.main, row);
        },
        readExact: unknownReader(),
      });
      assert.equal(receipt.status, 'unknown');
      assert.notEqual(receipt.status, 'missing');
      assert.equal(receipt.consecutiveFailures, 2);
      assert.equal(receipt.frozen, false);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('an unavailable control ledger blocks the business write entirely', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      const row = makeObservation(ctx, { messageSeq: 14 });
      const spec = observationSpec(row.id);
      const bizWrite = countCalls(() => insertObservation(ctx.main, row));
      const broken = closedControl(ctx.config);
      assert.throws(
        () =>
          commitControlled({
            control: broken,
            clock: ctx.clock,
            spec,
            writeTxn: bizWrite,
            readExact: () => readExactObservation(ctx.main, row),
          }),
        (err) => err instanceof ControlError && err.code === 'control_ledger_unavailable',
      );
      assert.equal(bizWrite.calls, 0);
      assert.equal(countRows(ctx.main, 'observations'), 0);
    } finally {
      ctx.cleanup();
    }
  });
});

test('M1 backup, restore and checkpoint', async (t) => {
  await t.test('backup captures committed WAL data and restores identical contents', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    try {
      assert.equal(backupCapability().backupApi, false);
      const row = makeObservation(ctx, { messageSeq: 21, text: '备份前写入的一句话。' });
      insertObservation(ctx.main, row);
      assert.equal(countRows(ctx.main, 'observations'), 1);
      // Data is committed in WAL; VACUUM INTO must still include it.
      assert.ok(fs.existsSync(`${ctx.config.dbPaths.main}-wal`));

      const result = backupAll({ config: ctx.config, handles: ctx.handles, clock: ctx.clock, label: 'm1-backup-test' });
      assert.equal(result.batch, 'm1-backup-test');
      assert.equal(result.manifest.files.length, 3);
      for (const file of result.manifest.files) {
        assert.equal(file.integrity, 'ok');
        assert.equal(file.foreignKeyViolations, 0);
        assert.ok(file.bytes > 0);
      }
      assert.equal(result.manifest.main_commit_seq, 1);

      const isolated = path.join(ctx.dir, 'restored');
      const restored = restoreToIsolated(result.batchDir, isolated);
      assert.equal(restored.copied.length, 3);
      const copy = openDatabase(path.join(isolated, 'memsys.db'));
      try {
        assert.equal(copy.prepare('SELECT text FROM observations WHERE id = ?').get(row.id).text, row.text);
        assert.equal(pragmaValue(copy, 'integrity_check'), 'ok');
      } finally {
        copy.close();
      }
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('checkpoint CLI writes source snapshot and database backups', () => {
    const ctx = createTestContext({ clock: fixedClock() });
    const outRoot = path.join(ctx.dir, 'checkpoints');
    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(ROOT, 'scripts/checkpoint.mjs'),
          '--label',
          'M1',
          '--data-dir',
          ctx.config.dataDir,
          '--out',
          outRoot,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CHECKPOINT_OK batch=\S+ source_files=\d+ dbs=3/);
      const batches = fs.readdirSync(outRoot);
      assert.equal(batches.length, 1);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(outRoot, batches[0], 'manifest.json'), 'utf8'),
      );
      assert.equal(manifest.databases.files.length, 3);
      assert.ok(Object.keys(manifest.source_files).length > 0);
    } finally {
      ctx.cleanup();
    }
  });
});
