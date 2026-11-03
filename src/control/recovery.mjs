import fs from 'node:fs';
import path from 'node:path';
import { completeAttempt, recordReconcile, unfreeze } from './ledger.mjs';
import { captureObservation } from '../write/capture.mjs';
import { completeDreamConfirmMain } from '../dream/confirm.mjs';
import { appendRelation } from '../storage/repositories.mjs';
import { verifyExpected } from './expected.mjs';
import { payloadHash } from '../identity.mjs';

/**
 * Restart recovery. Probes the authoritative store first (read-only, never a
 * write attempt), then closes the interrupted attempt in the control ledger.
 * A frozen stream that probes found only records reconciliation; it never
 * unfreezes itself.
 */

const PROBE_UNKNOWN = { status: 'unknown', reason: 'unprobeable_object' };

function verifyOperationReadback(operation, observation, control, main) {
  if (observation.status !== 'found') return observation;
  const row = observation.row;
  if (!row || typeof row.payload_hash !== 'string') return observation;
  if (!operation.object_key.startsWith('main:due:') && row.payload_hash !== operation.payload_hash) {
    return { status: 'unknown', reason: 'readback_hash_mismatch' };
  }
  if (control && main) {
    const expectedRow = control
      .prepare("SELECT target_ids FROM operation_steps WHERE parent_operation_id = ? AND step_name = '__expected__'")
      .get(operation.operation_id);
    if (expectedRow) {
      const expected = JSON.parse(expectedRow.target_ids);
      let actual = { row };
      if (expected.kind === 'due') {
        const memoryId = operation.object_key.split(':').slice(2).join(':');
        actual = {
          row,
          events: main
            .prepare("SELECT payload FROM relations WHERE type = 'due-state' AND json_extract(payload, '$.memoryId') = ?")
            .all(memoryId)
            .map((event) => ({ type: 'due-state', hash: payloadHash(JSON.parse(event.payload)) })),
        };
      }
      if (expected.kind === 'promote') {
        const candidateId = operation.object_key.slice('main:promote:'.length);
        actual = {
          row,
          events: main
            .prepare("SELECT 1 AS ok FROM relations WHERE type = 'promote' AND json_extract(payload, '$.candidateId') = ?")
            .all(candidateId)
            .map(() => ({ type: 'promote', key: candidateId })),
        };
      }
      if (expected.kind === 'candidate') {
        actual = {
          row,
          events: main
            .prepare("SELECT type, json_extract(payload, '$.targetId') AS targetId FROM relations WHERE type = 'shelve' AND json_extract(payload, '$.targetId') = ?")
            .all(row.id)
            .map((event) => ({ type: event.type, key: event.targetId })),
        };
      }
      const check = verifyExpected(expected.kind, expected, actual);
      if (!check.ok) return { status: 'unknown', reason: check.reason };
    }
  }
  return observation;
}


export function listInterrupted(control) {
  return control
    .prepare('SELECT * FROM object_streams WHERE inflight_attempt_no IS NOT NULL ORDER BY object_key')
    .all();
}

export function listStreams(control) {
  return control.prepare('SELECT * FROM object_streams ORDER BY object_key').all();
}

export function latestOperationFor(control, objectKey, generation) {
  return (
    control
      .prepare(
        `SELECT * FROM operations
         WHERE object_key = ? AND generation = ?
         ORDER BY created_at DESC, operation_id DESC LIMIT 1`,
      )
      .get(objectKey, generation) ?? null
  );
}

/**
 * Probe one main-database object by its controlled object key. Missing is only
 * returned when the authoritative table answers and the object is absent.
 */
export function probeMainObject(main, objectKey) {
  if (typeof objectKey !== 'string' || !objectKey.startsWith('main:')) {
    return PROBE_UNKNOWN;
  }
  const logicalId = objectKey.slice('main:'.length);
  try {
    if (logicalId.startsWith('promote:')) {
      const row = main
        .prepare('SELECT * FROM memories WHERE idempotency_key = ?')
        .get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'memory_absent' };
    }
    if (logicalId.startsWith('capture:')) {
      const row = main.prepare('SELECT * FROM candidates WHERE idempotency_key = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'candidate_absent' };
    }
    if (logicalId.startsWith('obs_')) {
      const row = main.prepare('SELECT * FROM observations WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'observation_absent' };
    }
    if (logicalId.startsWith('cand_')) {
      const row = main.prepare('SELECT * FROM candidates WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'candidate_absent' };
    }
    if (logicalId.startsWith('sn_')) {
      const row = main.prepare('SELECT * FROM self_notes WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'self_note_absent' };
    }
    if (logicalId.startsWith('jdg_')) {
      const row = main.prepare('SELECT * FROM judgments WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'judgment_absent' };
    }
    if (logicalId.startsWith('spec_')) {
      const row = main.prepare('SELECT * FROM speculations WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'speculation_absent' };
    }
    if (logicalId.startsWith('proj_')) {
      const row = main.prepare('SELECT * FROM projects WHERE id = ?').get(logicalId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'project_absent' };
    }
    if (logicalId.startsWith('due:')) {
      const memoryId = logicalId.slice('due:'.length);
      const row = main.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
      return row ? { status: 'found', row } : { status: 'missing', reason: 'due_memory_absent' };
    }
    if (logicalId.startsWith('mem_')) {
      const memory = main.prepare('SELECT * FROM memories WHERE id = ?').get(logicalId);
      if (!memory) return { status: 'missing', reason: 'memory_absent' };
      const evidence = main
        .prepare('SELECT COUNT(*) AS n FROM evidence WHERE memory_id = ?')
        .get(logicalId);
      const timeline = main.prepare('SELECT 1 AS ok FROM timeline WHERE memory_id = ?').get(logicalId);
      const pointer = main.prepare('SELECT 1 AS ok FROM pointers WHERE memory_id = ?').get(logicalId);
      if (Number(evidence.n) === 0 || !timeline || !pointer) {
        return { status: 'unknown', reason: 'projection_incomplete' };
      }
      return { status: 'found', row: memory };
    }
    return PROBE_UNKNOWN;
  } catch (err) {
    return { status: 'unknown', reason: 'probe_failed', error: err.message };
  }
}

/**
 * Recover every interrupted stream. `probe(main, objectKey)` may be injected by
 * tests; production passes the authoritative probe above.
 */

export function recoverCaptureJobs({ main, control, clock }) {
  const pending = main
    .prepare("SELECT * FROM relations WHERE type = 'capture-job' AND json_extract(payload, '$.status') = 'pending' ORDER BY commit_seq")
    .all();
  const results = [];
  for (const relation of pending) {
    const payload = JSON.parse(relation.payload);
    const observationId = payload.observationId;
    if (!observationId) continue;
    const done = main
      .prepare("SELECT 1 AS ok FROM relations WHERE type = 'capture-job' AND json_extract(payload, '$.observationId') = ? AND json_extract(payload, '$.status') = 'done'")
      .get(observationId);
    if (done) continue;
    try {
      const rebuilt = {
        role: 'daily',
        identity: payload.identity ?? 'recovery',
        sessionId: payload.sessionId ?? 'recovery',
        roundId: payload.roundId ?? null,
        messageSeq: payload.messageSeq ?? null,
        callId: payload.callId ?? 'capture-recovery',
        mode: payload.mode === 'life' ? 'life' : 'work',
        phase: 'daily',
      };
      const captured = captureObservation(rebuilt, observationId, { main, control, clock });
      const capturedOk =
        captured?.receipt?.status === 'found' ||
        captured?.capture?.receipt?.status === 'found' ||
        captured?.capture?.status === 'created' ||
        captured?.capture?.status === 'existing';
      if (!capturedOk) {
        results.push({ objectKey: 'main:' + observationId, kind: 'capture_incomplete' });
        continue;
      }
      main
        .prepare(
          "INSERT OR IGNORE INTO relations (id, type, payload, dedupe_key, at, commit_seq, ordinal, event_version, payload_version) VALUES (?, 'capture-job', ?, ?, ?, (SELECT COALESCE(MAX(commit_seq),0)+1 FROM relations), 0, '2', '2')",
        )
        .run(
          'cev-capture-done-' + observationId,
          JSON.stringify({ observationId, status: 'done', basis: 'recovery' }),
          'capture-job:' + observationId + ':done',
          clock.at().at,
        );
      results.push({ objectKey: 'main:' + observationId, kind: 'capture_rebuilt' });
    } catch (err) {
      results.push({ objectKey: 'main:' + observationId, kind: 'capture_recovery_failed', error: err.message });
    }
  }
  return results;
}


export function recoverDreamConfirmTasks({ main, dream, control, clock }) {
  const tasks = main
    .prepare("SELECT * FROM relations WHERE type = 'dream-confirm-task' AND json_extract(payload, '$.stage') = 'main_pending' ORDER BY commit_seq")
    .all();
  const results = [];
  const seen = new Set();
  for (const relation of tasks) {
    const plan = JSON.parse(relation.payload);
    if (seen.has(plan.confirmId)) continue;
    seen.add(plan.confirmId);
    const done = main
      .prepare("SELECT 1 AS ok FROM relations WHERE type = 'dream-confirm-task' AND json_extract(payload, '$.confirmId') = ? AND json_extract(payload, '$.stage') = 'done'")
      .get(plan.confirmId);
    if (done) continue;
    if (dream) {
      const voided = dream
        .prepare("SELECT 1 AS ok FROM relations WHERE (type = 'dream-void' AND json_extract(payload, '$.dreamId') = ?) OR (type IN ('dream-unconfirm','dream-revoke') AND json_extract(payload, '$.confirmId') = ?)")
        .get(plan.dreamId, plan.confirmId);
      if (voided) {
        results.push({ objectKey: 'dream-confirm:' + plan.confirmId, kind: 'dream_confirm_invalid' });
        continue;
      }
    }
    try {
      const completed = completeDreamConfirmMain({ main, control, clock }, plan);
      if (completed.ok) {
        appendRelation(main, {
          type: 'dream-confirm-task',
          payload: { confirmId: plan.confirmId, stage: 'done', basis: 'recovery' },
          businessKey: plan.confirmId + ':done',
          at: clock.at().at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
        results.push({ objectKey: 'dream-confirm:' + plan.confirmId, kind: 'dream_confirm_resumed' });
      } else {
        results.push({ objectKey: 'dream-confirm:' + plan.confirmId, kind: 'dream_confirm_incomplete', code: completed.code });
      }
    } catch (err) {
      results.push({ objectKey: 'dream-confirm:' + plan.confirmId, kind: 'dream_confirm_failed', error: err.message });
    }
  }
  return results;
}
export function recoverAll({ main, control, dream = null, clock, probe = probeMainObject }) {
  const results = [];
  for (const stream of listInterrupted(control)) {
    const operation = latestOperationFor(control, stream.object_key, stream.generation);
    if (!operation) {
      results.push({ objectKey: stream.object_key, kind: 'unknown_operation' });
      continue;
    }
    const observation = verifyOperationReadback(operation, safeProbe(probe, main, stream.object_key), control, main);

    if (Number(stream.frozen) === 1) {
      if (observation.status === 'found') {
        recordReconcile(control, clock, {
          objectKey: stream.object_key,
          operationId: operation.operation_id,
          readback: 'found',
        });
        results.push({ objectKey: stream.object_key, kind: 'reconciled_frozen', frozen: true });
      } else {
        results.push({ objectKey: stream.object_key, kind: 'frozen_kept', frozen: true });
      }
      continue;
    }

    if (observation.status === 'found') {
      const state = completeAttempt(control, clock, {
        objectKey: stream.object_key,
        operationId: operation.operation_id,
        generation: Number(stream.generation),
        attemptNo: Number(stream.inflight_attempt_no),
        result: 'found',
        readback: 'found',
      });
      results.push({ objectKey: stream.object_key, kind: 'recovered_found', cleared: state.failureCount === 0 });
      continue;
    }

    const result = observation.status === 'unknown' ? 'unknown' : 'missing';
    const state = completeAttempt(control, clock, {
      objectKey: stream.object_key,
      operationId: operation.operation_id,
      generation: Number(stream.generation),
      attemptNo: Number(stream.inflight_attempt_no),
      result,
      error: `interrupted_${result}`,
      readback: result,
    });
    results.push({
      objectKey: stream.object_key,
      kind: 'recovered_failed',
      result,
      failures: state.failureCount,
      frozen: state.frozen,
    });
  }
  results.push(...recoverCaptureJobs({ main, control, clock }));
  if (dream) results.push(...recoverDreamConfirmTasks({ main, dream, control, clock }));
  return results;
}

function safeProbe(probe, main, objectKey) {
  try {
    return probe(main, objectKey);
  } catch (err) {
    return { status: 'unknown', reason: 'probe_failed', error: err.message };
  }
}

/** Normalise one attempt scan: reserve-only means an interrupted attempt. */
export function attemptIntegrity(control, objectKey, generation) {
  const rows = control
    .prepare(
      'SELECT phase, attempt_no FROM operation_attempts WHERE object_key = ? AND generation = ?',
    )
    .all(objectKey, generation);
  const reserve = rows.filter((row) => row.phase === 'reserve').length;
  const complete = rows.filter((row) => row.phase === 'complete').length;
  return { reserve, complete, balanced: reserve === complete };
}

/** Explicit local-operator unfreeze (never a model action). */
export function operatorUnfreeze(control, clock, { objectKey, reason, operationId, operator }) {
  if (!operator || operator.role !== 'local-operator') {
    return { ok: false, code: 'invalid_operator_role' };
  }
  const result = unfreeze(control, clock, { objectKey, reason, operationId });
  return { ok: true, ...result };
}

/** Snapshot used by the maintenance report. */
export function streamReport(control, objectKey) {
  const stream = control.prepare('SELECT * FROM object_streams WHERE object_key = ?').get(objectKey);
  if (!stream) return null;
  const operation = latestOperationFor(control, objectKey, stream.generation);
  const attempts = attemptIntegrity(control, objectKey, stream.generation);
  return {
    objectKey,
    generation: Number(stream.generation),
    frozen: Number(stream.frozen) === 1,
    inflightAttemptNo: stream.inflight_attempt_no,
    consecutiveFailures: operation ? Number(operation.consecutive_failures) : 0,
    freezeReason: operation?.freeze_reason ?? null,
    lastReadback: operation?.last_readback ?? null,
    lastError: operation?.last_error ?? null,
    status: operation?.status ?? null,
    attempts,
  };
}

export const SERVICE_LOCK_NAME = 'service.lock';

/**
 * Single-writer service lock. A live holder is never pre-empted on a timer; a
 * provably dead holder can be taken over. PID reuse cannot be fully excluded
 * here, so takeover requires the recorded pid to be gone.
 */
export function acquireServiceLock({ dataDir, clock, instanceId = `inst-${process.pid}` }) {
  const lockPath = path.join(dataDir, SERVICE_LOCK_NAME);
  fs.mkdirSync(dataDir, { recursive: true });
  const payload = {
    pid: process.pid,
    instanceId,
    startedAt: clock.now().toISOString(),
    node: process.version,
  };
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify(payload));
    fs.closeSync(fd);
    return { acquired: true, lockPath, holder: payload };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!isProcessAlive(current.pid)) {
      fs.unlinkSync(lockPath);
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(payload));
      fs.closeSync(fd);
      return { acquired: true, lockPath, holder: payload, takenOverFrom: current };
    }
    return {
      acquired: false,
      code: 'service_lock_held',
      lockPath,
      holder: current,
    };
  }
}

export function releaseServiceLock({ dataDir }) {
  const lockPath = path.join(dataDir, SERVICE_LOCK_NAME);
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Frozen streams are never unfrozen automatically. If the authoritative store
 * now shows the object, only a reconciliation marker is written.
 */
export function reconcileFrozenStreams({ main, control, clock, probe = probeMainObject }) {
  const results = [];
  const streams = control.prepare('SELECT * FROM object_streams WHERE frozen = 1').all();
  for (const stream of streams) {
    const operation = latestOperationFor(control, stream.object_key, stream.generation);
    if (!operation) continue;
    if (operation.status === 'reconciled') {
      results.push({ objectKey: stream.object_key, kind: 'already_reconciled', frozen: true });
      continue;
    }
    const observation = safeProbe(probe, main, stream.object_key);
    if (observation.status === 'found') {
      recordReconcile(control, clock, {
        objectKey: stream.object_key,
        operationId: operation.operation_id,
        readback: 'found',
      });
      results.push({ objectKey: stream.object_key, kind: 'reconciled_found', frozen: true });
    } else {
      results.push({
        objectKey: stream.object_key,
        kind: 'no_evidence',
        probe: observation.status,
        frozen: true,
      });
    }
  }
  return results;
}

/** Re-read one historical operation against the current authoritative store. */
export function recheckOperation({ main, control, operationId, probe = probeMainObject }) {
  const operation = control.prepare('SELECT * FROM operations WHERE operation_id = ?').get(operationId);
  if (!operation) return { status: 'unknown', reason: 'operation_missing' };
  const observation = verifyOperationReadback(
    operation,
    safeProbe(probe, main, operation.object_key),
    control,
    main,
  );
  if (observation.status === 'found') {
    return { status: 'found', operationId, objectKey: operation.object_key };
  }
  return { status: observation.status, reason: observation.reason ?? null };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
