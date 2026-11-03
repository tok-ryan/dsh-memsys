import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonicalJson, payloadHash } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import { appendRelation } from '../storage/repositories.mjs';
import { WriteError } from '../write/authority.mjs';

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
    if (!match.file || !match.span || !match.spanHash) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'no_file_version_evidence' });
      continue;
    }
    let spanHash = null;
    try {
      const bytes = fs.readFileSync(match.file);
      const start = Number(match.span.start);
      const end = Number(match.span.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.length || start >= end) {
        skipped.push({ sourceObjectId: row.source_object_id, reason: 'span_out_of_range' });
        continue;
      }
      spanHash = crypto.createHash('sha256').update(bytes.slice(start, end)).digest('hex');
    } catch (err) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'file_unreadable', error: err.message });
      continue;
    }
    if (spanHash !== match.spanHash) {
      skipped.push({ sourceObjectId: row.source_object_id, reason: 'span_hash_mismatch' });
      continue;
    }
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
  const applied = [];
  for (const item of plan.items) {
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
