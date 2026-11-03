import { listStreams, operatorUnfreeze, streamReport } from './recovery.mjs';

/**
 * Local-operator maintenance: explicit unfreeze only. A model never reaches
 * this module; the operator role is supplied by the controlled launcher.
 */
export function maintenanceReport(control, { objectKey = null } = {}) {
  const streams = listStreams(control);
  const selected = objectKey ? streams.filter((stream) => stream.object_key === objectKey) : streams;
  return {
    checkedAt: null,
    streams: selected.map((stream) => streamReport(control, stream.object_key)),
    frozenCount: selected.filter((stream) => Number(stream.frozen) === 1).length,
    interruptedCount: selected.filter((stream) => stream.inflight_attempt_no !== null).length,
  };
}

export function unfreezeWithAudit(control, clock, { objectKey, reason, operationId = null, operator }) {
  if (!operator || operator.role !== 'local-operator') {
    return { ok: false, code: 'invalid_operator_role' };
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, code: 'unfreeze_reason_required' };
  }
  const before = streamReport(control, objectKey);
  if (!before) return { ok: false, code: 'object_stream_missing' };
  const result = operatorUnfreeze(control, clock, { objectKey, reason, operationId, operator });
  return {
    ok: result.ok !== false,
    before,
    after: streamReport(control, objectKey),
    generation: result.generation ?? null,
    reason,
  };
}
