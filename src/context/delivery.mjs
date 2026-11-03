import { canonicalJson } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';

/**
 * Delivery proof. Only a real host receipt with matching ids and payload hash
 * may insert per-memory exposure rows; otherwise delivery stays unknown.
 */
export function recordDelivery({
  main,
  control,
  clock,
  roundId,
  snapshotId,
  receivedIds = null,
  payloadHash = null,
  manifestHash = null,
  slots = {},
}) {
  const compilation = control
    .prepare('SELECT * FROM compilations WHERE id = ?')
    .get(`comp:${snapshotId}`);
  if (!compilation) {
    return { delivery: 'unknown', code: 'compilation_missing', confirmed_ids: [], missing_ids: [], extra_ids: [] };
  }
  if (compilation.round_id && compilation.round_id !== roundId) {
    return { delivery: 'unknown', code: 'receipt_round_mismatch', confirmed_ids: [], missing_ids: [], extra_ids: [] };
  }
  const snapshotRow = control
    .prepare('SELECT manifest_json FROM context_snapshots WHERE id = ?')
    .get(snapshotId);
  const manifest = snapshotRow?.manifest_json ? JSON.parse(snapshotRow.manifest_json) : null;
  // Design §6.2c: the receipt covers what was actually delivered. Deferred
  // members are not part of the receipt and never produce exposure rows.
  const deliveredGroups = (manifest?.expected_ids ?? []).filter((id) => String(id).startsWith('group:'));
  const actualMemories = (manifest?.actual_ids ?? []).filter((id) => String(id).startsWith('mem_'));
  const expected = [...new Set([...(manifest?.actual_ids ?? []), ...deliveredGroups])];
  const groups = deliveredGroups;
  const at = clock.at().at;

  let delivery = 'unknown';
  let missing = [];
  let extra = [];
  let hashMatched = false;
  let received = [];

  if (Array.isArray(receivedIds)) {
    received = [...receivedIds];
    const expectedSet = new Set(expected);
    const receivedSet = new Set(received);
    missing = expected.filter((id) => !receivedSet.has(id));
    extra = received.filter((id) => !expectedSet.has(id));
    hashMatched = payloadHash !== null && manifest?.hashes?.payload === payloadHash;
    if (missing.length === 0 && extra.length === 0 && hashMatched) {
      delivery = 'confirmed';
    } else if (received.length > 0) {
      delivery = 'incomplete';
    }
  }

  withImmediate(control, () => {
    control
      .prepare(
        `INSERT OR REPLACE INTO deliveries
           (round_id, snapshot_id, delivery, receipt_hash, received_ids, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        roundId,
        snapshotId,
        delivery,
        payloadHash,
        receivedIds === null ? null : canonicalJson(received),
        at,
      );
  });

  // Exposure lives in the main database; the delivery proof lives in control.
  // Cross-database atomicity is not claimed: if this write fails after the
  // control row, the caller still sees delivery=unknown and recovery rechecks.
  let exposureRowsWritten = 0;
  if (delivery === 'confirmed') {
    withImmediate(main, () => {
      const insert = main.prepare(
        `INSERT OR IGNORE INTO injections
           (round_id, memory_id, slots, topic_hits, manifest_hash, receipt_id, at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      );
      const deliverable = new Set(actualMemories);
      for (const id of received) {
        if (!deliverable.has(id)) continue;
        const exists = main.prepare('SELECT 1 AS ok FROM memories WHERE id = ?').get(id);
        if (!exists) continue;
        insert.run(roundId, id, canonicalJson(slots[id] ?? []), manifestHash, payloadHash, at);
        exposureRowsWritten += 1;
      }
    });
  }

  return {
    delivery,
    confirmed_ids: delivery === 'confirmed' ? received : [],
    missing_ids: missing,
    extra_ids: extra,
    group_descriptors: groups,
    code: delivery === 'confirmed' ? null : Array.isArray(receivedIds) ? 'receipt_incomplete' : 'receipt_missing',
    hash_matched: hashMatched,
    exposure_rows_written: exposureRowsWritten,
  };
}
