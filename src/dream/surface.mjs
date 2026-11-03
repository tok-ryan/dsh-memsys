import { freshness } from '../context/rank.mjs';
import { getState, putState } from '../storage/repositories.mjs';
import { parseOriginTokens } from '../write/origin.mjs';
import { confirmationState } from './replay.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SURFACE_THRESHOLD = 0.45;
export const SURFACE_METRIC = 'freshness';
export const SURFACE_CALIBRATION_TODO = 'if a topic query is added, recalibrate against full R (tag/literal/freshness), not freshness alone';

function dayKey(clock) {
  return Math.floor(clock.now().getTime() / DAY_MS);
}

function linkedRows(main, ids) {
  const rows = [];
  for (const id of ids) {
    const table = id.startsWith('mem_') ? 'memories' : null;
    if (!table) continue;
    const row = main.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    if (row) rows.push(row);
  }
  return rows;
}

function sceneAllowed(row, mode) {
  const sceneOk = row.scene === mode || row.scene === 'both';
  const scopeOk =
    row.scope === 'global' ||
    (mode === 'life' ? row.scope === 'life-only' : row.scope === 'work-only');
  return sceneOk && scopeOk;
}

/**
 * Dream surface: only unconfirmed propositions whose legal linked memories reach
 * raw freshness 0.45. Frequency is persisted per [sessionId, day, topic/dreamId].
 */
export function surfaceDreams({
  main,
  dream,
  clock,
  mode,
  sessionId,
  enabled = false,
  threshold = 0.45,
  limit = 1,
}) {
  if (!enabled || !dream) return { enabled: false, items: [], reason: 'surface_disabled' };
  const state = getState(main, 'dream-surface:frequency');
  const freq = state?.value ?? { keys: {}, revision: 0 };
  const frequency = freq.keys ?? {};
  const keyPrefix = `${sessionId}:${dayKey(clock)}`;
  const dreams = dream
    .prepare('SELECT * FROM dreams ORDER BY at ASC, id ASC')
    .all();
  const items = [];
  for (const dreamRow of dreams) {
    if (items.length >= limit) break;
    const linkedIds = JSON.parse(dreamRow.linked_ids ?? '[]');
    const legal = linkedRows(main, linkedIds).filter((row) => sceneAllowed(row, mode));
    if (legal.length === 0) continue;
    const best = Math.max(...legal.map((row) => freshness(row, clock.now().getTime())));
    if (best < threshold) continue;
    const voided = dream
      .prepare("SELECT 1 AS ok FROM relations WHERE type = 'dream-void' AND json_extract(payload, '$.dreamId') = ?")
      .get(dreamRow.id);
    if (voided) continue;
    const propositions = dream
      .prepare('SELECT * FROM propositions WHERE dream_id = ? ORDER BY ordinal')
      .all(dreamRow.id);
    if (propositions.length === 0) continue;
    const confirmations = confirmationState(dream);
    const unconfirmed = propositions.find((proposition) => !confirmations.get(proposition.id)?.valid);
    if (!unconfirmed) continue;
    const sceneRow = legal.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    const topicKey = sceneRow.topic_key ?? dreamRow.id;
    const freqKey = `${keyPrefix}:${topicKey}`;
    if (frequency[freqKey]) continue;
    frequency[freqKey] = true;
    items.push({
      dreamId: dreamRow.id,
      propositionId: unconfirmed.id,
      typedId: `dream:${unconfirmed.id}`,
      text: unconfirmed.text,
      scene: sceneRow.scene,
      freshness: best,
      frequencyKey: freqKey,
      notification: 'unknown',
      delivery: 'unknown',
    });
  }
  if (items.length > 0) {
    const revision = Number(state?.revision ?? 0) + 1;
    putState(main, 'dream-surface:frequency', { keys: frequency, revision }, revision);
  }
  return { enabled: true, items, reason: null };
}

export function dreamSurfaceEnabled(main) {
  return getState(main, 'dream-surface:enabled')?.value?.enabled === true;
}

export function originIsDream(origin) {
  return parseOriginTokens(origin).some((token) => /^d-.*#p\d+$/.test(token));
}
