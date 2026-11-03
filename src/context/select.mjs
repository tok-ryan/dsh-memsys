import { currentRevision } from '../storage/open.mjs';
import { listRelations } from '../storage/repositories.mjs';
import { foldMemoryState } from '../storage/replay.mjs';

const EXCLUDED_DUE = new Set(['pending-due', 'shelved-due', 'pending-done', 'cooled-due']);

/**
 * The eligible fact set S for one window. Type/credibility/permission boundaries
 * are hard exclusions (not budget cuts); unresolved and quoted entries stay in.
 */
function dreamValidity(dream) {
  const rows = dream.prepare('SELECT * FROM relations ORDER BY commit_seq').all();
  const voidedDreams = new Set();
  const revokedConfirms = new Set();
  const confirmDreams = new Map();
  const activeConfirms = new Set();
  for (const relation of rows) {
    let payload = {};
    try {
      payload = JSON.parse(relation.payload);
    } catch {
      continue;
    }
    if (relation.type === 'dream-void') {
      if (payload.dreamId) voidedDreams.add(payload.dreamId);
      continue;
    }
    if (relation.type === 'dream-unconfirm' || relation.type === 'dream-revoke') {
      if (payload.confirmId) revokedConfirms.add(payload.confirmId);
      if (payload.dreamId) voidedDreams.add(payload.dreamId);
      continue;
    }
    if (relation.type === 'confirm' && payload.confirmId) {
      confirmDreams.set(payload.confirmId, payload.dreamId);
      activeConfirms.add(payload.confirmId);
    }
  }
  return {
    validConfirm(confirmId) {
      return activeConfirms.has(confirmId) && !revokedConfirms.has(confirmId);
    },
    validDream(dreamId) {
      return !voidedDreams.has(dreamId) && [...confirmDreams.values()].includes(dreamId);
    },
  };
}

function dreamTokenOf(origin) {
  try {
    const tokens = JSON.parse(origin ?? '[]');
    if (!Array.isArray(tokens)) return null;
    const token = tokens.find((entry) => typeof entry === 'string' && /#p\d+$/.test(entry));
    return token ? token.split('#p')[0] : null;
  } catch {
    return null;
  }
}

export function selectEligible({ main, mode, dream = null }) {
  const relations = listRelations(main);
  const rows = main
    .prepare(
      `SELECT m.*, t.start_at AS business_start, t.time_state AS time_state
       FROM memories AS m
       LEFT JOIN timeline AS t ON t.memory_id = m.id
       WHERE m.due_state NOT IN ('pending-due', 'shelved-due', 'pending-done', 'cooled-due')
       ORDER BY m.id`,
    )
    .all();
  const revoked = new Set();
  const confirmLinks = new Map();
  const revokedConfirms = new Set();
  for (const relation of relations) {
    if (relation.type === 'dream-revoke') {
      try {
        const payload = JSON.parse(relation.payload);
        if (payload.confirmId) revokedConfirms.add(payload.confirmId);
        if (payload.memoryId) revoked.add(payload.memoryId);
      } catch {
        // malformed revoke rows never re-enable a dream fact
      }
      continue;
    }
    if (relation.type === 'dream-confirm-link') {
      try {
        const payload = JSON.parse(relation.payload);
        if (!payload.memoryId) continue;
        const previous = confirmLinks.get(payload.memoryId);
        if (!previous || Number(relation.commit_seq) > Number(previous.commitSeq)) {
          confirmLinks.set(payload.memoryId, { ...payload, commitSeq: Number(relation.commit_seq) });
        }
      } catch {
        // ignore malformed link
      }
      continue;
    }
    if (relation.type === 'supersede') {
      try {
        const payload = JSON.parse(relation.payload);
        if (payload.oldId) revoked.add(payload.oldId);
        else if (payload.oldMemoryId) revoked.add(payload.oldMemoryId);
      } catch {
        // ignore
      }
    }
  }
  const validity = dream ? dreamValidity(dream) : null;
  const items = [];
  for (const row of rows) {
    if (row.credibility === 'from-dream' && !confirmLinks.get(row.id)) continue;
    const link = confirmLinks.get(row.id);
    if (validity) {
      const sourceDream = dreamTokenOf(row.origin);
      if (link) {
        if (!validity.validConfirm(link.confirmId)) continue;
      } else if (sourceDream && !validity.validDream(sourceDream)) {
        continue;
      }
    }
    if (link && revokedConfirms.has(link.confirmId)) continue;
    if (!link && revoked.has(row.id)) continue;
    const factState = foldMemoryState(relations, row.id);
    if (factState !== 'active') continue;
    if (EXCLUDED_DUE.has(row.due_state)) continue;
    const sceneOk = row.scene === mode || row.scene === 'both';
    const scopeOk =
      row.scope === 'global' ||
      (mode === 'life' ? row.scope === 'life-only' : row.scope === 'work-only');
    if (!sceneOk || !scopeOk) continue;
    items.push({ ...row, factState, time_state: row.time_state ?? 'point' });
  }
  return { items, revision: currentRevision(main) };
}

export function categoryOf(memory) {
  if (typeof memory.topic_key === 'string' && memory.topic_key.startsWith('tk:')) {
    return 'registered';
  }
  return 'ungrouped';
}

export function sceneLabel(scene) {
  if (scene === 'life') return '生活';
  if (scene === 'work') return '工作';
  return '跨场景';
}

export function categoryLabel(category) {
  if (category === 'registered') return '已归组记忆';
  if (category === 'ungrouped') return '未归组记忆';
  if (category === 'review') return '审核项';
  return category;
}

/** Display groups: scene × category, at most 12 top-level groups, empty omitted. */
export function buildGroups(items) {
  const map = new Map();
  for (const item of items) {
    const category = categoryOf(item);
    const groupId = `${item.scene}:${category}`;
    if (!map.has(groupId)) {
      map.set(groupId, {
        groupId,
        scene: item.scene,
        category,
        name: `${sceneLabel(item.scene)}·${categoryLabel(category)}`,
        members: [],
      });
    }
    map.get(groupId).members.push(item);
  }
  return [...map.values()]
    .sort((a, b) => a.groupId.localeCompare(b.groupId))
    .slice(0, 12);
}
