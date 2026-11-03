import { canonicalJson } from '../identity.mjs';
import { currentRevision, withImmediate } from '../storage/open.mjs';
import { codePoints, truncateCodePoints } from './budget.mjs';
import { categoryOf } from './select.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_CHARS_DEFAULT = 8000;
export const MAX_CHARS_MIN = 1000;
export const MAX_CHARS_MAX = 16000;

function clampMaxChars(value) {
  if (!Number.isFinite(value)) return MAX_CHARS_DEFAULT;
  return Math.min(MAX_CHARS_MAX, Math.max(MAX_CHARS_MIN, Math.round(value)));
}

function bindHash(binding) {
  return Buffer.from(canonicalJson(binding), 'utf8').toString('base64url').slice(0, 12);
}

export function encodeCursor({ snapshotRevision, groupId, offset }) {
  return Buffer.from(
    canonicalJson({
      v: 1,
      s: snapshotRevision,
      g: groupId,
      o: offset,
      h: bindHash({ snapshotRevision, groupId }),
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || typeof parsed.s !== 'string' || typeof parsed.g !== 'string') return null;
    if (!Number.isInteger(parsed.o) || parsed.o < 0) return null;
    if (parsed.h !== bindHash({ snapshotRevision: parsed.s, groupId: parsed.g })) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist one compilation snapshot plus its groups, directory items and the
 * capacity ledger row. Every row is written inside one control transaction.
 */
export function createSnapshot({
  control,
  clock,
  snapshotId,
  roundId,
  mode,
  level,
  sourceRevision,
  policyRevision,
  sectionText,
  sectionHash,
  eligibleIds,
  expectedIds,
  groups,
  retentionDays = 30,
  manifestJson = null,
  statusText = null,
  H,
  metrics,
}) {
  const at = clock.at().at;
  const expiresAt = new Date(clock.now().getTime() + retentionDays * DAY_MS).toISOString();
  const deferredGroups = groups.map((group) => ({
    group_id: group.groupId,
    name: group.name,
    deferred_count: group.members.length,
    fetch: {
      tool: 'memsys_context_get',
      args: {
        snapshot_revision: snapshotId,
        group_id: group.groupId,
        cursor: null,
        max_chars: MAX_CHARS_DEFAULT,
        view: 'current',
      },
    },
  }));

  withImmediate(control, () => {
    const existing = control
      .prepare('SELECT manifest_json, mode, source_revision FROM context_snapshots WHERE id = ?')
      .get(snapshotId);
    if (existing) {
      let existingSection = null;
      try {
        existingSection = JSON.parse(existing.manifest_json ?? '{}')?.hashes?.section ?? null;
      } catch {
        existingSection = null;
      }
      if (existingSection !== sectionHash) {
        const err = new Error('snapshot_id_conflict');
        err.code = 'snapshot_id_conflict';
        throw err;
      }
    }
    control
      .prepare(
        `INSERT OR REPLACE INTO compilations
           (id, round_id, stream_key, source_revision, policy_revision, delivery_level,
            payload_hash, section_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `comp:${snapshotId}`,
        roundId,
        `${mode}:inject-stream`,
        sourceRevision,
        policyRevision,
        level,
        sectionHash,
        sectionText,
        at,
      );
    control
      .prepare(
        `INSERT OR REPLACE INTO context_snapshots
           (id, compilation_id, round_id, mode, source_revision, policy_revision,
            delivery_level, eligible_ids, expected_ids, deferred_groups, created_at,
            expires_at, retention_days, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshotId,
        `comp:${snapshotId}`,
        roundId,
        mode,
        sourceRevision,
        policyRevision,
        level,
        canonicalJson(eligibleIds),
        canonicalJson(expectedIds),
        canonicalJson(deferredGroups),
        at,
        expiresAt,
        retentionDays,
        manifestJson ? canonicalJson(manifestJson) : null,
      );
    control.prepare('DELETE FROM snapshot_groups WHERE snapshot_id = ?').run(snapshotId);
    control.prepare('DELETE FROM snapshot_items WHERE snapshot_id = ?').run(snapshotId);
    const insertGroup = control.prepare(
      `INSERT INTO snapshot_groups (snapshot_id, group_id, name, total_count, deferred_count)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertItem = control.prepare(
      `INSERT INTO snapshot_items (snapshot_id, memory_id, group_id, ordinal, directory_text, scene, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const persistedGroups = statusText ? [...groups, { groupId: '__status__', name: '__status__', members: [{ id: 'status:__status__', text: statusText, scene: mode, business_start: null, semantic_status: 'quoted', credibility: 'unverified', topic_key: null }] }] : groups;
    for (const group of persistedGroups) {
      insertGroup.run(snapshotId, group.groupId, group.name, group.members.length, group.members.length);
      group.members.forEach((member, index) => {
        const category = categoryOf(member);
        const line = `${member.id} · ${truncateCodePoints(member.text, 80)} · ${member.business_start ?? 'unknown'} · ${member.semantic_status}/${member.credibility} · ${member.topic_key?.startsWith('tk:') ? '已归组' : '未归组'}`;
        insertItem.run(snapshotId, member.id, group.groupId, index, line, member.scene, category);
      });
    }
    control
      .prepare(
        `INSERT OR REPLACE INTO capacity_rounds
           (round_id, snapshot_id, hard_count, hard_bytes, hard_tokens, H, K,
            soft_count, soft_bytes, soft_tokens, soft_H, delivery_level,
            full_directory_bytes, payload_bytes, tokens, group_count, subgroup_count,
            eligible_count, deferred_count, soft_over_streak, hard_over_streak,
            protected_over_streak, policy_version, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        roundId,
        snapshotId,
        Number(metrics.hard.memberCount ?? 0),
        metrics.hard.bytes,
        metrics.hard.tokens,
        H,
        metrics.hard.tokens,
        metrics.soft.codePoints,
        metrics.soft.bytes,
        metrics.soft.tokens,
        H,
        level,
        metrics.fullDirectoryBytes,
        Buffer.byteLength(sectionText, 'utf8'),
        metrics.total.tokens,
        metrics.groupCount,
        groups.length,
        eligibleIds.length,
        metrics.deferredCount,
        0,
        0,
        0,
        policyRevision,
        at,
      );
  });

  return {
    id: snapshotId,
    expires_at: expiresAt,
    groups,
    eligible_ids: eligibleIds,
    expected_ids: expectedIds,
    deferred_groups: deferredGroups,
    section_text: sectionText,
    payload_hash: sectionHash,
  };
}

export function staleCursor(control, clock) {
  const latest = control
    .prepare('SELECT id FROM context_snapshots ORDER BY created_at DESC, id DESC LIMIT 1')
    .get();
  return {
    status: 'error',
    code: 'stale_cursor',
    fresh_report_entry: latest
      ? {
          snapshot_revision: latest.id,
          args: {
            snapshot_revision: latest.id,
            group_id: '__status__',
            cursor: null,
            max_chars: MAX_CHARS_DEFAULT,
            view: 'current',
          },
        }
      : null,
    clock: clock.at().at,
  };
}

/**
 * Page one snapshot group. Pagination never re-reads live memory rows, so a
 * later data change cannot be spliced into an old page.
 */
export function getGroupPage({
  control,
  main = null,
  clock,
  snapshotRevision,
  groupId,
  cursor = null,
  maxChars = MAX_CHARS_DEFAULT,
  view = 'current',
}) {
  const snapshot = control
    .prepare('SELECT * FROM context_snapshots WHERE id = ?')
    .get(snapshotRevision);
  if (!snapshot) return staleCursor(control, clock);
  if (Date.parse(snapshot.expires_at) <= clock.now().getTime()) {
    return staleCursor(control, clock);
  }
  if (view !== 'current' && view !== 'history') {
    return { status: 'error', code: 'validation_error', message: 'invalid_view', clock: clock.at().at };
  }
  const group = control
    .prepare('SELECT * FROM snapshot_groups WHERE snapshot_id = ? AND group_id = ?')
    .get(snapshotRevision, groupId);
  if (!group) {
    return { status: 'error', code: 'group_missing', snapshot_revision: snapshotRevision, group_id: groupId, clock: clock.at().at };
  }

  let offset = 0;
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    if (!decoded) {
      return { status: 'error', code: 'invalid_cursor', clock: clock.at().at };
    }
    if (decoded.s !== snapshotRevision || decoded.g !== groupId) {
      return { status: 'error', code: 'invalid_cursor', reason: 'cursor_binding_mismatch', clock: clock.at().at };
    }
    if (main) {
      const manifest = snapshot.manifest_json ? JSON.parse(snapshot.manifest_json) : {};
      const expectedCount = Array.isArray(manifest.eligible_ids) ? manifest.eligible_ids.length : null;
      const currentCount = Number(main.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
      if (
        Number(snapshot.source_revision) !== Number(currentRevision(main)) ||
        (expectedCount !== null && currentCount > expectedCount)
      ) {
        return staleCursor(control, clock);
      }
    }
    offset = decoded.o;
  }

  const rows = control
    .prepare(
      'SELECT * FROM snapshot_items WHERE snapshot_id = ? AND group_id = ? ORDER BY ordinal ASC',
    )
    .all(snapshotRevision, groupId);
  const limit = clampMaxChars(maxChars);
  const page = [];
  let used = 0;
  let index = offset;
  while (index < rows.length) {
    const row = rows[index];
    const size = codePoints(row.directory_text);
    if (page.length > 0 && used + size > limit) break;
    page.push({
      id: row.memory_id,
      text: row.directory_text,
      scene: row.scene,
      category: row.category,
    });
    used += size;
    index += 1;
  }
  const remaining = Math.max(0, rows.length - index);
  const nextCursor =
    remaining > 0 ? encodeCursor({ snapshotRevision, groupId, offset: index }) : null;

  const subgroups = control
    .prepare(
      'SELECT group_id, name, total_count FROM snapshot_groups WHERE snapshot_id = ? ORDER BY group_id',
    )
    .all(snapshotRevision)
    .map((row) => ({
      id: row.group_id,
      name: row.name,
      count: Number(row.total_count),
      fetch: {
        tool: 'memsys_context_get',
        args: { snapshot_revision: snapshotRevision, group_id: row.group_id, cursor: null, max_chars: MAX_CHARS_DEFAULT, view },
      },
    }));

  return {
    status: 'ok',
    snapshot_revision: snapshotRevision,
    group_id: groupId,
    name: group.name,
    total_count: Number(group.total_count),
    deferred_count: Number(group.deferred_count),
    page_count: page.length,
    remaining_count: remaining,
    items: page,
    subgroup_total: subgroups.length,
    subgroups,
    subgroups_next_cursor: null,
    next_cursor: nextCursor,
    truncated: nextCursor !== null,
    clock: clock.at().at,
  };
}

export function snapshotReport(control, snapshotRevision) {
  const snapshot = control
    .prepare('SELECT * FROM context_snapshots WHERE id = ?')
    .get(snapshotRevision);
  if (!snapshot) return null;
  const groups = control
    .prepare('SELECT * FROM snapshot_groups WHERE snapshot_id = ? ORDER BY group_id')
    .all(snapshotRevision);
  return {
    snapshot_revision: snapshot.id,
    round_id: snapshot.round_id,
    mode: snapshot.mode,
    delivery_level: snapshot.delivery_level,
    expires_at: snapshot.expires_at,
    groups: groups.map((row) => ({
      group_id: row.group_id,
      name: row.name,
      total_count: Number(row.total_count),
      deferred_count: Number(row.deferred_count),
    })),
  };
}
