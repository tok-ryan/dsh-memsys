import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll } from '../src/storage/open.mjs';
import { migrateAll } from '../src/storage/migrate.mjs';
import {
  countRows,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertMemory,
  insertObservation,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import { keys } from '../src/identity.mjs';
import { commitControlled } from '../src/control/commit.mjs';
import { ControlError, reserveAttempt } from '../src/control/ledger.mjs';
import {
  attemptIntegrity,
  acquireServiceLock,
  probeMainObject,
  reconcileFrozenStreams,
  recoverAll,
  recheckOperation,
  releaseServiceLock,
} from '../src/control/recovery.mjs';
import { maintenanceReport, unfreezeWithAudit } from '../src/control/maintenance.mjs';
import { readExact, readExactMemorySet, readExactObservation } from '../src/control/readback.mjs';
import { promoteInTransaction } from '../src/write/promote.mjs';
import { systemClock } from '../src/clock.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';
import { makeCandidate, makeObservation } from './helpers/fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'test', 'helpers', 'worker.mjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-m3-'));
}

function openAt(dir) {
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  migrateAll(handles, { clock: systemClock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, systemClock);
    handles.main.exec('COMMIT');
  } catch (err) {
    try {
      handles.main.exec('ROLLBACK');
    } catch {
      // keep original
    }
    throw err;
  }
  return {
    dir,
    config,
    handles,
    main: handles.main,
    control: handles.control,
    clock: systemClock,
    close() {
      closeAll(handles);
    },
  };
}

function runWorker(dir, args) {
  return spawnSync(process.execPath, [WORKER, '--data-dir', dir, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
}

function lastJson(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForFile(file, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) return true;
    sleep(25);
  }
  return false;
}

test('M3 crash breakpoints close with exact recovery', async (t) => {
  await t.test('crash before reserve leaves nothing behind', () => {
    const dir = tempDir();
    const result = runWorker(dir, ['--scenario', 'observe', '--stop-at', 'before_reserve', '--message-seq', '1']);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      assert.equal(countRows(ctx.main, 'observations'), 0);
      assert.equal(Number(ctx.control.prepare('SELECT COUNT(*) AS n FROM object_streams').get().n), 0);
      assert.deepEqual(recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock }), []);
    } finally {
      ctx.close();
    }
  });

  await t.test('crash after reserve records one pre-deducted failure, never a missing success', () => {
    const dir = tempDir();
    const result = runWorker(dir, ['--scenario', 'observe', '--stop-at', 'after_reserve', '--message-seq', '1']);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      assert.equal(countRows(ctx.main, 'observations'), 0);
      const stream = ctx.control.prepare('SELECT * FROM object_streams').get();
      assert.notEqual(stream.inflight_attempt_no, null);
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].kind, 'recovered_failed');
      assert.equal(recovered[0].result, 'missing');
      assert.equal(recovered[0].failures, 1);
      assert.equal(recovered[0].frozen, false);
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(Number(operation.consecutive_failures), 1);
      assert.equal(operation.status, 'failed');
    } finally {
      ctx.close();
    }
  });

  await t.test('crash after the observation commit recovers found without duplicating', () => {
    const dir = tempDir();
    const result = runWorker(dir, ['--scenario', 'observe', '--stop-at', 'after_write', '--message-seq', '1']);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      assert.equal(countRows(ctx.main, 'observations'), 1);
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      assert.equal(recovered[0].kind, 'recovered_found');
      assert.equal(recovered[0].cleared, true);
      const stream = ctx.control.prepare('SELECT * FROM object_streams').get();
      assert.equal(stream.inflight_attempt_no, null);
      assert.equal(Number(stream.frozen), 0);
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(operation.status, 'found');
      assert.equal(Number(operation.consecutive_failures), 0);
      assert.deepEqual(attemptIntegrity(ctx.control, stream.object_key, stream.generation), {
        reserve: 1,
        complete: 1,
        balanced: true,
      });
      assert.equal(countRows(ctx.main, 'observations'), 1);
    } finally {
      ctx.close();
    }
  });

  await t.test('crash between readback and control receipt is recovered as found', () => {
    const dir = tempDir();
    const result = runWorker(dir, [
      '--scenario', 'observe', '--stop-at', 'before_control_complete', '--message-seq', '2',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      assert.equal(recovered[0].kind, 'recovered_found');
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(operation.status, 'found');
      assert.equal(attemptIntegrity(ctx.control, operation.object_key, 0).balanced, true);
    } finally {
      ctx.close();
    }
  });

  await t.test('crash after the control receipt keeps a clean replay identity', () => {
    const dir = tempDir();
    const result = runWorker(dir, [
      '--scenario', 'observe', '--stop-at', 'after_control_complete', '--message-seq', '3',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      const stream = ctx.control.prepare('SELECT * FROM object_streams').get();
      assert.equal(stream.inflight_attempt_no, null);
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(operation.status, 'found');
      let writes = 0;
      const receipt = commitControlled({
        control: ctx.control,
        clock: systemClock,
        spec: {
          objectKey: operation.object_key,
          targetDb: 'main',
          requestKey: operation.request_key,
          payloadHash: operation.payload_hash,
          immutablePayload: operation.immutable_payload,
          targetIds: [operation.object_key.slice('main:'.length)],
        },
        writeTxn: () => {
          writes += 1;
        },
        readExact: () => ({ status: 'found', reason: 'already' }),
      });
      assert.equal(receipt.replayed, true);
      assert.equal(writes, 0);
    } finally {
      ctx.close();
    }
  });

  await t.test('crash after a candidate commit recovers found with the promoted memory', () => {
    const dir = tempDir();
    const result = runWorker(dir, ['--scenario', 'candidate', '--stop-at', 'after_write', '--message-seq', '4']);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      assert.equal(countRows(ctx.main, 'candidates'), 2, 'capture plus tool candidate');
      assert.equal(countRows(ctx.main, 'memories'), 1);
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      assert.equal(recovered.some((row) => row.kind === 'recovered_found'), true);
    } finally {
      ctx.close();
    }
  });

  await t.test('a crash inside a promotion step rolls back the whole six-step unit', () => {
    const dir = tempDir();
    const result = runWorker(dir, ['--scenario', 'promote', '--step', '2', '--message-seq', '5']);
    assert.equal(result.status, 0, result.stderr);
    const ctx = openAt(dir);
    try {
      assert.equal(countRows(ctx.main, 'observations'), 1, 'observation was committed first');
      assert.equal(countRows(ctx.main, 'memories'), 0, 'crashed promotion left no memory');
      const toolCandidates = ctx.main
        .prepare("SELECT COUNT(*) AS n FROM candidates WHERE source_path = 'tool'")
        .get();
      assert.equal(Number(toolCandidates.n), 0, 'crashed transaction left no candidate');
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      assert.equal(recovered[0].kind, 'recovered_failed');
      assert.equal(recovered[0].result, 'missing');
    } finally {
      ctx.close();
    }
  });
});

test('M3 freeze, restart and reconciliation', async (t) => {
  await t.test('two failures plus a restarted third failure freeze at 3 and block the fourth write', () => {
    const dir = tempDir();
    const common = ['--scenario', 'fail-once', '--object', 'obs_freeze_1', '--request', 'req-freeze-1'];
    for (let run = 1; run <= 3; run += 1) {
      const result = runWorker(dir, common);
      assert.equal(result.status, 0, result.stderr);
    }
    const ctx = openAt(dir);
    try {
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(Number(operation.consecutive_failures), 3);
      assert.equal(Number(operation.frozen), 1);
      const stream = ctx.control.prepare('SELECT * FROM object_streams').get();
      assert.equal(Number(stream.frozen), 1);
      assert.deepEqual(attemptIntegrity(ctx.control, stream.object_key, stream.generation), {
        reserve: 3,
        complete: 3,
        balanced: true,
      });

      let writes = 0;
      assert.throws(
        () =>
          commitControlled({
            control: ctx.control,
            clock: systemClock,
            spec: {
              objectKey: 'main:obs_freeze_1',
              targetDb: 'main',
              requestKey: 'req-freeze-1',
              payloadHash: 'payload-hash-1',
              immutablePayload: '{"probe":1}',
              targetIds: ['obs_freeze_1'],
            },
            writeTxn: () => {
              writes += 1;
            },
            readExact: () => ({ status: 'found' }),
          }),
        (err) => err instanceof ControlError && err.code === 'object_frozen',
      );
      assert.equal(writes, 0);
      assert.equal(countRows(ctx.main, 'observations'), 0);
    } finally {
      ctx.close();
    }
  });

  await t.test('a third attempt that reads found clears the counter across a restart', () => {
    const dir = tempDir();
    const common = ['--scenario', 'fail-once', '--object', 'obs_clear_1', '--request', 'req-clear-1'];
    runWorker(dir, common);
    runWorker(dir, common);
    const success = runWorker(dir, [
      '--scenario', 'commit-found', '--object', 'obs_clear_1', '--request', 'req-clear-1',
    ]);
    assert.equal(success.status, 0, success.stderr);
    const payload = lastJson(success.stdout);
    assert.equal(payload.status, 'found');
    assert.equal(payload.failures, 0);
    assert.equal(payload.frozen, false);
    const ctx = openAt(dir);
    try {
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(Number(operation.consecutive_failures), 0);
      assert.equal(Number(operation.frozen), 0);
      assert.equal(operation.status, 'found');
    } finally {
      ctx.close();
    }
  });

  await t.test('a frozen stream never unfreezes on reconciliation', () => {
    const dir = tempDir();
    const common = ['--scenario', 'fail-once', '--object', 'obs_reconcile_1', '--request', 'req-reconcile'];
    runWorker(dir, common);
    runWorker(dir, common);
    runWorker(dir, common);
    const ctx = openAt(dir);
    try {
      const observation = makeObservation(ctx, { messageSeq: 900, text: '冻结后出现' });
      observation.id = 'obs_reconcile_1';
      insertObservation(ctx.main, observation);
      const results = reconcileFrozenStreams({
        main: ctx.main,
        control: ctx.control,
        clock: systemClock,
      });
      assert.equal(results[0].kind, 'reconciled_found');
      const operation = ctx.control.prepare('SELECT * FROM operations').get();
      assert.equal(operation.status, 'reconciled');
      assert.equal(Number(operation.frozen), 1);
      assert.equal(Number(ctx.control.prepare('SELECT * FROM object_streams').get().frozen), 1);
      assert.throws(
        () =>
          reserveAttempt(ctx.control, systemClock, {
            objectKey: 'main:obs_reconcile_1',
            targetDb: 'main',
            requestKey: 'req-reconcile',
            payloadHash: 'payload-hash-1',
            immutablePayload: '{"probe":1}',
            targetIds: ['obs_reconcile_1'],
          }),
        (err) => err instanceof ControlError && err.code === 'object_frozen',
      );
      assert.equal(maintenanceReport(ctx.control).frozenCount, 1);
    } finally {
      ctx.close();
    }
  });

  await t.test('local operator unfreeze bumps generation; model role is refused', () => {
    const dir = tempDir();
    const common = ['--scenario', 'fail-once', '--object', 'obs_unfreeze_1', '--request', 'req-unfreeze'];
    runWorker(dir, common);
    runWorker(dir, common);
    runWorker(dir, common);
    const ctx = openAt(dir);
    try {
      const refused = unfreezeWithAudit(ctx.control, systemClock, {
        objectKey: 'main:obs_unfreeze_1',
        reason: 'model attempt',
        operator: { role: 'daily' },
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'invalid_operator_role');
      const noReason = unfreezeWithAudit(ctx.control, systemClock, {
        objectKey: 'main:obs_unfreeze_1',
        reason: '  ',
        operator: { role: 'local-operator' },
      });
      assert.equal(noReason.code, 'unfreeze_reason_required');
      const operationId = ctx.control
        .prepare('SELECT operation_id FROM operations LIMIT 1')
        .get().operation_id;
      const done = unfreezeWithAudit(ctx.control, systemClock, {
        objectKey: 'main:obs_unfreeze_1',
        reason: 'operator verified manual fix',
        operationId,
        operator: { role: 'local-operator' },
      });
      assert.equal(done.ok, true);
      assert.equal(done.before.frozen, true);
      assert.equal(done.after.frozen, false);
      assert.equal(done.after.generation, 1);
      assert.equal(
        Number(ctx.control.prepare("SELECT COUNT(*) AS n FROM control_events WHERE type = 'unfreeze'").get().n),
        1,
      );
      assert.equal(countRows(ctx.main, 'observations'), 0);
    } finally {
      ctx.close();
    }
  });
});

test('M3 readback classes and history', async (t) => {
  await t.test('unknown is never reported as missing', () => {
    const dir = tempDir();
    const ctx = openAt(dir);
    try {
      const missing = readExact(ctx.main, {
        table: 'observations',
        keyValue: 'obs_absent',
        fields: ['id'],
        expected: { id: 'obs_absent' },
      });
      assert.equal(missing.status, 'missing');

      const observation = makeObservation(ctx, { messageSeq: 10, text: '原文' });
      insertObservation(ctx.main, observation);

      const mismatch = readExact(ctx.main, {
        table: 'observations',
        keyValue: observation.id,
        fields: ['text'],
        expected: { text: '被改过的原文' },
      });
      assert.equal(mismatch.status, 'unknown');
      assert.equal(mismatch.reason, 'field_mismatch');

      const throwingDb = {
        prepare() {
          const err = new Error('database is locked');
          err.code = 'SQLITE_BUSY';
          throw err;
        },
      };
      assert.equal(
        readExact(throwingDb, {
          table: 'observations',
          keyValue: observation.id,
          fields: ['id'],
          expected: { id: observation.id },
        }).status,
        'unknown',
      );
      const deniedDb = {
        prepare() {
          const err = new Error('access denied');
          err.code = 'EACCES';
          throw err;
        },
      };
      assert.equal(
        readExact(deniedDb, {
          table: 'observations',
          keyValue: observation.id,
          fields: ['id'],
          expected: { id: observation.id },
        }).status,
        'unknown',
      );
    } finally {
      ctx.close();
    }
  });

  await t.test('historical projection changes do not invalidate the original operation', () => {
    const dir = tempDir();
    const ctx = openAt(dir);
    try {
      const runtime = fakeRuntime();
      const observation = makeObservation(ctx, { messageSeq: 11, text: '历史投影' });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation, {
        businessKey: 'history:1',
        text: '历史投影记忆',
        why: '测试历史投影',
        timeState: 'ongoing',
        startAt: '2026-11-01T00:00:00.000Z',
      });
      insertCandidate(ctx.main, candidate);
      insertEvidence(ctx.main, {
        id: 'ev_history_1',
        memory_id: null,
        candidate_id: candidate.id,
        observation_id: observation.id,
        source_memory_id: null,
        role: 'basis',
        source_span: 'bytes:0:18',
        at: systemClock.at().at,
      });

      const spec = {
        objectKey: `main:${keys.promote(candidate.id)}`,
        targetDb: 'main',
        requestKey: `promote:${candidate.id}`,
        payloadHash: candidate.payload_hash,
        immutablePayload: '{"history":1}',
        targetIds: [candidate.id],
      };
      const receipt = commitControlled({
        control: ctx.control,
        clock: systemClock,
        spec,
        writeTxn: () => {
          ctx.main.exec('BEGIN IMMEDIATE');
          try {
            promoteInTransaction(ctx.main, { candidate, runtime, clock: systemClock });
            ctx.main.exec('COMMIT');
          } catch (err) {
            ctx.main.exec('ROLLBACK');
            throw err;
          }
        },
        readExact: () => {
          const memory = ctx.main
            .prepare('SELECT * FROM memories WHERE idempotency_key = ?')
            .get(keys.promote(candidate.id));
          if (!memory) return { status: 'missing', reason: 'memory_absent' };
          const evidenceIds = ctx.main
            .prepare('SELECT id FROM evidence WHERE memory_id = ?')
            .all(memory.id)
            .map((row) => row.id);
          return readExactMemorySet(ctx.main, memory, evidenceIds);
        },
      });
      assert.equal(receipt.status, 'found');

      const memory = ctx.main
        .prepare('SELECT * FROM memories WHERE idempotency_key = ?')
        .get(keys.promote(candidate.id));
      ctx.main.prepare('UPDATE timeline SET revision = 2, time_state = ? WHERE memory_id = ?').run(
        'ended_unknown',
        memory.id,
      );
      ctx.main.prepare('UPDATE memories SET last_touched_at = ? WHERE id = ?').run(
        '2026-11-20T00:00:00.000Z',
        memory.id,
      );
      const checked = recheckOperation({
        main: ctx.main,
        control: ctx.control,
        operationId: receipt.operationId,
      });
      assert.equal(checked.status, 'found');

      // A memory row with no projections is an index orphan: unknown, not found.
      const orphanCandidate = makeCandidate(ctx, observation, { businessKey: 'history:orphan' });
      insertCandidate(ctx.main, orphanCandidate);
      insertMemory(ctx.main, {
        ...memory,
        id: 'mem_incomplete_1',
        idempotency_key: 'promote:incomplete',
        promoted_from: orphanCandidate.id,
      });
      const orphan = probeMainObject(ctx.main, 'main:mem_incomplete_1');
      assert.equal(orphan.status, 'unknown');
      assert.equal(orphan.reason, 'projection_incomplete');
    } finally {
      ctx.close();
    }
  });

  await t.test('a failed control receipt reports unknown while the business row exists', () => {
    const dir = tempDir();
    const ctx = openAt(dir);
    try {
      const observation = makeObservation(ctx, { messageSeq: 12, text: '回执失败' });
      const receipt = commitControlled({
        control: ctx.control,
        clock: systemClock,
        spec: {
          objectKey: `main:${observation.id}`,
          targetDb: 'main',
          requestKey: `observe:${observation.id}`,
          payloadHash: observation.payload_hash,
          immutablePayload: '{"probe":1}',
          targetIds: [observation.id],
          repair: false,
          hooks: {
            beforeControlComplete() {
              ctx.control.close();
            },
          },
        },
        writeTxn: () => insertObservation(ctx.main, observation),
        readExact: () => readExactObservation(ctx.main, observation),
      });
      assert.equal(receipt.status, 'unknown');
      assert.equal(receipt.controlReceipt, 'failed');
      assert.equal(countRows(ctx.main, 'observations'), 1);
      ctx.close();

      const reopened = openAt(dir);
      try {
        const recovered = recoverAll({
          main: reopened.main,
          control: reopened.control,
          clock: systemClock,
        });
        assert.equal(recovered[0].kind, 'recovered_found');
      } finally {
        reopened.close();
      }
    } finally {
      ctx.close();
    }
  });
});

test('M3 multi-process ownership and service lock', async (t) => {
  await t.test('two processes: one in-flight per object, different objects continue', async () => {
    const dir = tempDir();
    const marker = path.join(dir, 'holder.ready');
    const holder = spawn(
      process.execPath,
      [
        WORKER,
        '--data-dir', dir,
        '--scenario', 'hold-reserve',
        '--object', 'obs_conc_1',
        '--request', 'req-holder',
        '--marker', marker,
      ],
      { stdio: 'ignore' },
    );
    try {
      assert.equal(waitForFile(marker), true, 'holder did not reserve in time');
      const sameObject = runWorker(dir, [
        '--scenario', 'try-reserve', '--object', 'obs_conc_1', '--request', 'req-second',
      ]);
      assert.equal(sameObject.status, 0, sameObject.stderr);
      assert.deepEqual(lastJson(sameObject.stdout), {
        scenario: 'try-reserve',
        ok: false,
        code: 'object_inflight',
      });
      const differentObject = runWorker(dir, [
        '--scenario', 'try-reserve', '--object', 'obs_conc_2', '--request', 'req-third',
      ]);
      assert.equal(differentObject.status, 0, differentObject.stderr);
      assert.equal(lastJson(differentObject.stdout).ok, true);
    } finally {
      holder.kill('SIGKILL');
    }
    await new Promise((resolve) => holder.on('exit', resolve));

    const ctx = openAt(dir);
    try {
      const otherBefore = ctx.control
        .prepare('SELECT * FROM object_streams WHERE object_key = ?')
        .get('main:obs_conc_2');
      assert.equal(otherBefore.inflight_attempt_no, 1, 'different object kept its own in-flight attempt');
      const recovered = recoverAll({ main: ctx.main, control: ctx.control, clock: systemClock });
      const holderRecovery = recovered.find((row) => row.objectKey === 'main:obs_conc_1');
      assert.equal(holderRecovery.kind, 'recovered_failed');
      assert.equal(holderRecovery.failures, 1);
    } finally {
      ctx.close();
    }
  });

  await t.test('service lock refuses a live holder and takes over a dead one', () => {
    const dir = tempDir();
    assert.equal(acquireServiceLock({ dataDir: dir, clock: systemClock }).acquired, true);
    const refused = runWorker(dir, ['--scenario', 'lock']);
    assert.equal(refused.status, 0, refused.stderr);
    assert.deepEqual(lastJson(refused.stdout), {
      scenario: 'lock',
      acquired: false,
      code: 'service_lock_held',
    });
    releaseServiceLock({ dataDir: dir });

    const workerLock = runWorker(dir, ['--scenario', 'lock']);
    assert.equal(workerLock.status, 0, workerLock.stderr);
    assert.equal(lastJson(workerLock.stdout).acquired, true);

    const takeover = acquireServiceLock({ dataDir: dir, clock: systemClock });
    assert.equal(takeover.acquired, true);
    assert.ok(takeover.takenOverFrom.pid > 0);
    releaseServiceLock({ dataDir: dir });
  });
});
