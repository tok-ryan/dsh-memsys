import { ControlError, completeAttempt, reserveAttempt } from './ledger.mjs';
import { canonicalJson, payloadHash } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import { verifyExpected } from './expected.mjs';

function safeRead(readExact) {
  try {
    return readExact();
  } catch (err) {
    return { status: 'unknown', reason: 'readback_threw', error: err.message };
  }
}

/**
 * Test seam only: named breakpoints used by the child-process harness. They are
 * never derived from model input; production callers pass nothing.
 */
function hookRunner(hooks = {}) {
  return (name, ...args) => {
    if (typeof hooks[name] === 'function') hooks[name](...args);
  };
}

/**
 * Close one attempt in the control ledger. A control-write failure must not be
 * reported as business success: the business commit may already have landed, so
 * the caller receives unknown + controlReceipt=failed and recovery decides later.
 */
function finishAttempt(control, clock, input) {
  try {
    return { state: completeAttempt(control, clock, input), controlReceipt: 'written' };
  } catch (err) {
    return {
      state: null,
      controlReceipt: 'failed',
      controlError: err instanceof ControlError ? err.code : err.message,
    };
  }
}

function receiptFrom({ spec, reservation, attempts, readback, repairBlocked, state, controlReceipt }) {
  return Object.freeze({
    status: controlReceipt === 'failed' ? 'unknown' : readback.status,
    operationId: reservation.operationId,
    objectKey: spec.objectKey,
    attempts,
    readback,
    repairBlocked: repairBlocked === true,
    consecutiveFailures: state?.failureCount ?? null,
    frozen: state?.frozen ?? false,
    controlReceipt: controlReceipt ?? 'written',
  });
}

/**
 * Controlled commit: control ledger first (pre-deducted attempt), then the
 * business transaction, then an exact readback. At most one immediate
 * idempotent repair write is allowed; a third non-found completion freezes the
 * object stream.
 *
 * `writeTxn` and `repairTxn` must be idempotent by stable key: a replay with the
 * same key must return the existing object rather than insert a duplicate.
 */
export function commitControlled({ control, clock, spec, writeTxn, readExact, repairTxn }) {
  const attempts = [];
  const call = hookRunner(spec.hooks);

  call('beforeReserve', spec);
  const reservation = reserveAttempt(control, clock, spec);
  call('afterReserve', reservation);

  if (reservation.found) {
    return Object.freeze({
      status: 'found',
      replayed: true,
      operationId: reservation.operationId,
      objectKey: spec.objectKey,
      attempts: [],
      readback: { status: 'found', reason: 'previous_commit' },
      repairBlocked: false,
      consecutiveFailures: 0,
      frozen: reservation.frozen,
      controlReceipt: 'written',
    });
  }

  attempts.push(reservation.attemptNo);
  if (spec.expected) {
    withImmediate(control, () => {
      control
        .prepare(
          `INSERT OR IGNORE INTO operation_steps
             (id, parent_operation_id, step_name, child_operation_id, target_db, target_ids, payload_hash, at)
           VALUES (?, ?, '__expected__', ?, 'control', ?, ?, ?)`,
        )
        .run(
          'expected:' + reservation.operationId,
          reservation.operationId,
          reservation.operationId,
          canonicalJson(spec.expected),
          payloadHash(spec.expected),
          clock.at().at,
        );
    });
  }

  let writeError = null;
  try {
    writeTxn();
  } catch (err) {
    writeError = err;
  }
  call('afterWrite', { writeError });

  let readback = writeError
    ? { status: 'unknown', reason: 'write_failed', error: writeError.message }
    : safeRead(readExact);
  call('afterRead', readback);

  const finish = (result, error, rb) => {
    call('beforeControlComplete', { result });
    const finished = finishAttempt(control, clock, {
      objectKey: spec.objectKey,
      operationId: reservation.operationId,
      generation: reservation.generation,
      attemptNo: reservation.attemptNo,
      result,
      error,
      readback: rb ?? result,
    });
    call('afterControlComplete', finished);
    return finished;
  };

  if (readback.status === 'found' && spec.expected && spec.actual) {
    const check = verifyExpected(spec.expected.kind, spec.expected, spec.actual());
    if (!check.ok) {
      readback = { status: 'unknown', reason: check.reason };
    }
  }
  if (readback.status === 'found') {
    const finished = finish('found', undefined, 'found');
    return receiptFrom({
      spec,
      reservation,
      attempts,
      readback,
      state: finished.state,
      controlReceipt: finished.controlReceipt,
    });
  }

  if (spec.repair === false || writeError) {
    const finished = finish(readback.status, readback.reason ?? readback.status, readback.status);
    return receiptFrom({
      spec,
      reservation,
      attempts,
      readback,
      state: finished.state,
      controlReceipt: finished.controlReceipt,
    });
  }

  // Close the first attempt before reserving the single repair attempt; the
  // stream allows only one in-flight attempt at a time.
  finishAttempt(control, clock, {
    objectKey: spec.objectKey,
    operationId: reservation.operationId,
    generation: reservation.generation,
    attemptNo: reservation.attemptNo,
    result: readback.status,
    error: readback.reason ?? readback.status,
    readback: readback.status,
  });

  // One conditional repair attempt, counted and pre-deducted like any other.
  let second;
  try {
    second = reserveAttempt(control, clock, spec);
  } catch (err) {
    return {
      ...receiptFrom({
        spec,
        reservation,
        attempts,
        readback,
        state: {
          failureCount: reservation.consecutiveFailures,
          frozen: err.code === 'object_frozen',
        },
      }),
      repairBlocked: true,
      repairError: err.code ?? err.message,
    };
  }

  attempts.push(second.attemptNo);
  let repairError = null;
  try {
    (repairTxn ?? writeTxn)();
  } catch (err) {
    repairError = err;
  }
  const repaired = repairError
    ? { status: 'unknown', reason: 'repair_write_failed', error: repairError.message }
    : safeRead(readExact);
  const result = repaired.status === 'found' ? 'found' : repaired.status;
  const finished = finishAttempt(control, clock, {
    objectKey: spec.objectKey,
    operationId: reservation.operationId,
    generation: second.generation,
    attemptNo: second.attemptNo,
    result,
    error: result === 'found' ? undefined : repaired.reason ?? result,
    readback: result,
  });
  return receiptFrom({
    spec,
    reservation,
    attempts,
    readback: repaired,
    state: finished.state,
    controlReceipt: finished.controlReceipt,
  });
}

export { ControlError };
