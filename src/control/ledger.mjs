import { objectId, sha256Hex } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';

export class ControlError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export const CONTROL_UNAVAILABLE = 'control_ledger_unavailable';

function guard(control, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ControlError) throw err;
    throw new ControlError(CONTROL_UNAVAILABLE, { cause: err.message });
  }
}

function streamRow(control, objectKey) {
  return (
    control.prepare('SELECT * FROM object_streams WHERE object_key = ?').get(objectKey) ?? null
  );
}

function attemptId(objectKey, generation, attemptNo, phase) {
  return objectId('att', `${objectKey}:${generation}:${attemptNo}:${phase}`);
}

function appendEvent(control, clock, type, objectKey, payload) {
  const at = clock.at().at;
  control
    .prepare('INSERT INTO control_events (id, type, object_key, payload, at) VALUES (?, ?, ?, ?, ?)')
    .run(objectId('cev', `${type}:${objectKey}:${at}:${sha256Hex(JSON.stringify(payload))}`), type, objectKey, JSON.stringify(payload), at);
}

function ensureStream(control, clock, objectKey, targetDb) {
  const at = clock.at().at;
  control
    .prepare(
      `INSERT OR IGNORE INTO object_streams
         (object_key, target_db, generation, frozen, inflight_attempt_no, updated_at)
       VALUES (?, ?, 0, 0, NULL, ?)`,
    )
    .run(objectKey, targetDb, at);
}

export function readStream(control, objectKey) {
  return streamRow(control, objectKey);
}

export function readOperation(control, operationId) {
  return control.prepare('SELECT * FROM operations WHERE operation_id = ?').get(operationId) ?? null;
}

export function readOperationByRequest(control, requestKey) {
  return control.prepare('SELECT * FROM operations WHERE request_key = ?').get(requestKey) ?? null;
}

export function listAttempts(control, objectKey, generation) {
  return control
    .prepare(
      `SELECT * FROM operation_attempts
       WHERE object_key = ? AND generation = ?
       ORDER BY attempt_no ASC, phase ASC`,
    )
    .all(objectKey, generation);
}

/**
 * Pre-deduct one attempt: persist the attempt row and increment the failure
 * counter BEFORE the business write. Control-ledger failure therefore stops the
 * business write instead of letting it run on unrecorded assumptions.
 */
export function reserveAttempt(
  control,
  clock,
  spec,
) {
  const outcome = guard(control, () =>
    withImmediate(control, () => {
      const at = clock.at().at;
      ensureStream(control, clock, spec.objectKey, spec.targetDb);
      const stream = streamRow(control, spec.objectKey);
      if (!stream) throw new ControlError('object_stream_missing', { objectKey: spec.objectKey });
      if (Number(stream.frozen) === 1) {
        throw new ControlError('object_frozen', { objectKey: spec.objectKey, generation: stream.generation });
      }
      const failureCount = (() => {
        const rows = control
          .prepare(
            "SELECT result FROM operation_attempts WHERE object_key = ? AND generation = ? AND phase = 'complete' ORDER BY attempt_no DESC",
          )
          .all(spec.objectKey, Number(stream.generation));
        let count = 0;
        for (const row of rows) {
          if (row.result === 'found') break;
          count += 1;
        }
        return count;
      })();
      if (failureCount >= 3) {
        control
          .prepare('UPDATE object_streams SET frozen = 1, updated_at = ? WHERE object_key = ?')
          .run(clock.at().at, spec.objectKey);
        appendEvent(control, clock, 'freeze', spec.objectKey, { reason: 'logical_object_three_failures' });
        return {
          __freeze: true,
          error: new ControlError('object_frozen', { objectKey: spec.objectKey, consecutiveFailures: failureCount }),
        };
      }
      if (stream.inflight_attempt_no !== null) {
        throw new ControlError('object_inflight', {
          objectKey: spec.objectKey,
          inflightAttemptNo: stream.inflight_attempt_no,
        });
      }

      let operation = control
        .prepare('SELECT * FROM operations WHERE request_key = ?')
        .get(spec.requestKey);
      if (operation) {
        if (operation.payload_hash !== spec.payloadHash) {
          throw new ControlError('idempotency_conflict', {
            requestKey: spec.requestKey,
            stored: operation.payload_hash,
            incoming: spec.payloadHash,
          });
        }
        if (operation.status === 'found') {
          return {
            replayed: true,
            found: true,
            operationId: operation.operation_id,
            generation: Number(stream.generation),
            attemptNo: Number(operation.attempt_no ?? 0),
            consecutiveFailures: Number(operation.consecutive_failures),
            frozen: Number(operation.frozen) === 1,
          };
        }
        if (Number(operation.consecutive_failures) >= 3) {
          throw new ControlError('object_frozen', {
            objectKey: spec.objectKey,
            consecutiveFailures: Number(operation.consecutive_failures),
          });
        }
      }

      const next = control
        .prepare(
          'SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM operation_attempts WHERE object_key = ? AND generation = ?',
        )
        .get(spec.objectKey, stream.generation);
      const attemptNo = Number(next.n);
      const operationId = operation?.operation_id ?? spec.operationId ?? objectId('op', spec.requestKey);

      if (operation) {
        control
          .prepare(
            `UPDATE operations
             SET consecutive_failures = consecutive_failures + 1, status = 'reserved', last_error = NULL
             WHERE operation_id = ?`,
          )
          .run(operationId);
      } else {
        control
          .prepare(
            `INSERT INTO operations
               (operation_id, object_key, request_key, target_db, immutable_payload, payload_hash,
                target_ids, created_at, status, consecutive_failures, frozen, generation,
                last_readback, last_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 1, 0, ?, NULL, NULL)`,
          )
          .run(
            operationId,
            spec.objectKey,
            spec.requestKey,
            spec.targetDb,
            spec.immutablePayload,
            spec.payloadHash,
            JSON.stringify(spec.targetIds ?? []),
            at,
            Number(stream.generation),
          );
      }

      control
        .prepare(
          `INSERT INTO operation_attempts
             (id, object_key, generation, attempt_no, operation_id, phase, at, result, error,
              expected_hash, actual_hash)
           VALUES (?, ?, ?, ?, ?, 'reserve', ?, NULL, NULL, ?, NULL)`,
        )
        .run(
          attemptId(spec.objectKey, Number(stream.generation), attemptNo, 'reserve'),
          spec.objectKey,
          Number(stream.generation),
          attemptNo,
          operationId,
          at,
          spec.payloadHash,
        );

      control
        .prepare('UPDATE object_streams SET inflight_attempt_no = ?, updated_at = ? WHERE object_key = ?')
        .run(attemptNo, at, spec.objectKey);

      appendEvent(control, clock, 'reserve', spec.objectKey, {
        operationId,
        attemptNo,
        payloadHash: spec.payloadHash,
      });

      return {
        replayed: false,
        found: false,
        operationId,
        generation: Number(stream.generation),
        attemptNo,
        consecutiveFailures: operation ? Number(operation.consecutive_failures) + 1 : 1,
        frozen: false,
      };
    }),
  );
  if (outcome?.__freeze) throw outcome.error;
  return outcome;
}

/**
 * Close one attempt. Only a true found readback clears the consecutive-failure
 * counter; the third non-found completion freezes the stream.
 */
export function completeAttempt(control, clock, input) {
  return guard(control, () =>
    withImmediate(control, () => {
      const at = clock.at().at;
      const operation = control
        .prepare('SELECT * FROM operations WHERE operation_id = ?')
        .get(input.operationId);
      if (!operation) {
        throw new ControlError('operation_missing', { operationId: input.operationId });
      }
      const phaseId = attemptId(input.objectKey, input.generation, input.attemptNo, 'complete');
      const exists = control.prepare('SELECT id FROM operation_attempts WHERE id = ?').get(phaseId);
      if (!exists) {
        control
          .prepare(
            `INSERT INTO operation_attempts
               (id, object_key, generation, attempt_no, operation_id, phase, at, result, error,
                expected_hash, actual_hash)
             VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?)`,
          )
          .run(
            phaseId,
            input.objectKey,
            input.generation,
            input.attemptNo,
            input.operationId,
            at,
            input.result,
            input.error ?? null,
            input.expectedHash ?? operation.payload_hash,
            input.actualHash ?? null,
          );
      }

      const rows = control
        .prepare(
          "SELECT result FROM operation_attempts WHERE object_key = ? AND generation = ? AND phase = 'complete' ORDER BY attempt_no DESC",
        )
        .all(input.objectKey, input.generation);
      let failures = 0;
      for (const row of rows) {
        if (row.result === 'found') break;
        failures += 1;
      }
      let frozen = Number(operation.frozen) === 1;
      if (input.result === 'found') {
        control
          .prepare(
            `UPDATE operations
             SET consecutive_failures = 0, status = 'found', last_readback = ?, last_error = NULL
             WHERE operation_id = ?`,
          )
          .run(input.readback ?? 'found', input.operationId);
      } else {
        frozen = failures >= 3;
        control
          .prepare(
            `UPDATE operations
             SET status = ?, last_readback = ?, last_error = ?, frozen = ?, freeze_reason = ?, consecutive_failures = ?
             WHERE operation_id = ?`,
          )
          .run(
            frozen ? 'frozen' : 'failed',
            input.readback ?? null,
            input.error ?? input.result,
            frozen ? 1 : 0,
            frozen ? (operation.freeze_reason ?? `three_failures:${input.result}`) : operation.freeze_reason ?? null,
            failures,
            input.operationId,
          );
        if (frozen) {
          control
            .prepare('UPDATE object_streams SET frozen = 1, updated_at = ? WHERE object_key = ?')
            .run(at, input.objectKey);
          appendEvent(control, clock, 'freeze', input.objectKey, {
            operationId: input.operationId,
            attemptNo: input.attemptNo,
            reason: input.error ?? input.result,
          });
        }
      }

      control
        .prepare('UPDATE object_streams SET inflight_attempt_no = NULL, updated_at = ? WHERE object_key = ?')
        .run(at, input.objectKey);
      appendEvent(control, clock, input.result === 'found' ? 'success' : 'failure', input.objectKey, {
        operationId: input.operationId,
        attemptNo: input.attemptNo,
        result: input.result,
      });

      return {
        operationId: input.operationId,
        failureCount: input.result === 'found' ? 0 : failures,
        frozen,
      };
    }),
  );
}

/** A found result after freezing is recorded for reconciliation only; it stays frozen. */
export function recordReconcile(control, clock, { objectKey, operationId, readback }) {
  return guard(control, () =>
    withImmediate(control, () => {
      appendEvent(control, clock, 'reconcile', objectKey, { operationId, readback });
      control
        .prepare(`UPDATE operations SET status = 'reconciled', last_readback = ? WHERE operation_id = ?`)
        .run(readback, operationId);
      return { reconciled: true };
    }),
  );
}

/** Controlled local-operator unfreeze: new generation, old attempt history kept. */
export function unfreeze(control, clock, { objectKey, reason, operationId }) {
  return guard(control, () =>
    withImmediate(control, () => {
      const at = clock.at().at;
      const stream = streamRow(control, objectKey);
      if (!stream) throw new ControlError('object_stream_missing', { objectKey });
      control
        .prepare(
          `UPDATE object_streams
           SET generation = generation + 1, frozen = 0, inflight_attempt_no = NULL, updated_at = ?
           WHERE object_key = ?`,
        )
        .run(at, objectKey);
      if (operationId) {
        control
          .prepare(
            `UPDATE operations
             SET consecutive_failures = 0, frozen = 0, freeze_reason = NULL, status = 'unfrozen',
                 generation = generation + 1
             WHERE operation_id = ?`,
          )
          .run(operationId);
      }
      appendEvent(control, clock, 'unfreeze', objectKey, {
        reason,
        newGeneration: Number(stream.generation) + 1,
      });
      return { objectKey, generation: Number(stream.generation) + 1 };
    }),
  );
}
