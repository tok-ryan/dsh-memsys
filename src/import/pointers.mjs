import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonicalJson, payloadHash } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import { appendRelation } from '../storage/repositories.mjs';
import { WriteError } from '../write/authority.mjs';

export function verifyPointerSource({ row, match, observationText }) {
  if (!match?.file || !match?.span) return { ok: false, reason: 'no_file_version_evidence' };
  const start = Number(match.span.start);
  const end = Number(match.span.end);
  let bytes;
  try {
    bytes = fs.readFileSync(match.file);
  } catch (err) {
    return { ok: false, reason: 'file_unreadable', error: err.message };
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.length || start >= end) {
    return { ok: false, reason: 'span_out_of_range' };
  }
  const slice = bytes.slice(start, end);
  const spanHash = crypto.createHash('sha256').update(slice).digest('hex');
  if (spanHash !== match.spanHash) return { ok: false, reason: 'span_hash_mismatch' };
  const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (match.fileHash && fileHash !== match.fileHash) return { ok: false, reason: 'file_hash_mismatch' };
  if (match.location !== `${match.file}#bytes:${start}-${end}`) return { ok: false, reason: 'location_not_byte_binding' };
  if (typeof observationText !== 'string' || slice.toString('utf8') !== observationText) {
    return { ok: false, reason: 'observation_text_mismatch' };
  }
  if (match.versionHash !== row.source_version_hash) return { ok: false, reason: 'version_hash_mismatch' };
  return { ok: true, spanHash, fileHash, observationText };
}

/** Match the imported source version, never "the latest path with this name". */
export function planPointers({ main, clock }, versionsFile) {
  const parsed = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
  const versions = Array.isArray(parsed.versions) ? parsed.versions : [];
  const imported = main
    .prepare("SELECT * FROM import_items WHERE item_kind = 'memory' AND source_system = 'whale-soul' ORDER BY source_object_id")
    .all();
  const items = [];
  const skipped = [];
  for (const row of imported) {
    const targets = JSON.parse(row.target_ids);
    const memoryId = targets[2];
    if (!memoryId) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'no_memory' });
      continue;
    }
    const memory = main.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (!memory) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'memory_missing' });
      continue;
    }
    const match = versions.find(
      (version) =>
        version.sourceObjectId === row.source_object_id &&
        version.versionHash === row.source_version_hash,
    );
    if (!match || !match.location) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'no_version_match' });
      continue;
    }
    const observationId = targets[0];
    const observation = observationId ? main.prepare('SELECT * FROM observations WHERE id = ?').get(observationId) : null;
    const observed = verifyPointerSource({ row, match, observationText: observation?.text });
    if (!observed.ok) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: observed.reason, error: observed.error });
      continue;
    }
    const spanHash = observed.spanHash;
    const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memoryId);
    if (pointer?.status === 'exact' && pointer.location === match.location) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'already_exact' });
      continue;
    }
    const revision = Number(pointer?.revision ?? 0) + 1;
    const payload = {
      memoryId,
      status: 'exact',
      location: match.location,
      searchHint: match.searchHint ?? pointer?.search_hint ?? null,
      basis: 'pointer-backfill',
      matchedVersionHash: row.source_version_hash,
      file: match.file,
      span: match.span,
      spanHash,
      sourceFileHash: observed.fileHash,
      observationHash: payloadHash(observed.observationText),
      revision,
    };
    items.push({
      memoryId,
      sourceObjectId: row.source_object_id,
      matchedVersionHash: row.source_version_hash,
      location: match.location,
      spanHash,
      payload,
      payloadHash: payloadHash(payload),
    });
  }
  const body = { policy: 'legacy-v1', items, skipped };
  const planHash = payloadHash(body);
  return { ...body, planHash, clock: clock.at().at };
}

export function applyPointers({ main, clock }, plan) {
  const recomputed = payloadHash({ policy: 'legacy-v1', items: plan.items, skipped: plan.skipped });
  if (recomputed !== plan.planHash) throw new WriteError('plan_hash_mismatch');
  const applied = [];
  for (const item of plan.items) {
    let bytes;
    try {
      bytes = fs.readFileSync(item.payload.file);
    } catch (err) {
      throw new WriteError('source_unreadable', { memoryId: item.memoryId, error: err.message });
    }
    const start = Number(item.payload.span.start);
    const end = Number(item.payload.span.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.length || start >= end) {
      throw new WriteError('source_span_changed', { memoryId: item.memoryId });
    }
    const spanHash = crypto.createHash('sha256').update(bytes.slice(start, end)).digest('hex');
    const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const evidence = main
      .prepare('SELECT observation_id FROM evidence WHERE memory_id = ? ORDER BY id LIMIT 1')
      .get(item.memoryId);
    const observation = evidence?.observation_id
      ? main.prepare('SELECT text FROM observations WHERE id = ?').get(evidence.observation_id)
      : null;
    if (
      spanHash !== item.payload.spanHash ||
      fileHash !== item.payload.sourceFileHash ||
      payloadHash(observation?.text ?? '') !== item.payload.observationHash
    ) {
      throw new WriteError('source_bytes_changed', { memoryId: item.memoryId });
    }
    const exists = main
      .prepare(
        "SELECT payload FROM relations WHERE type = 'pointer-change' AND json_extract(payload, '$.memoryId') = ? AND json_extract(payload, '$.basis') = 'pointer-backfill'",
      )
      .get(item.memoryId);
    if (exists) {
      const payload = JSON.parse(exists.payload);
      if (payloadHash(payload) !== item.payloadHash) {
        throw new WriteError('idempotency_conflict', { memoryId: item.memoryId });
      }
      continue;
    }
    withImmediate(main, () => {
      appendRelation(main, {
        type: 'pointer-change',
        payload: item.payload,
        businessKey: canonicalJson([item.memoryId, item.payload.revision, 'pointer-backfill']),
        at: clock.at().at,
        keyEncoding: 'canonical',
        eventVersion: '2',
        payloadVersion: '2',
      });
      main
        .prepare('UPDATE pointers SET status = ?, location = ?, search_hint = ?, revision = revision + 1 WHERE memory_id = ?')
        .run(item.payload.status, item.payload.location, item.payload.searchHint, item.memoryId);
    });
    applied.push(item.memoryId);
  }
  return { applied, skipped: plan.skipped.length };
}
