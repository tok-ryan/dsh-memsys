import { rankItems } from '../context/rank.mjs';
import { payloadHash } from '../identity.mjs';
import { pageText } from './pager.mjs';

const DEFAULT_MAX_CHARS = 8000;

function clampChars(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(16000, Math.max(1000, Math.round(value)));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase();
}

function validBound(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  return name ? value : value;
}

/**
 * Coarse business time from timeline; unknown stays unknown. Uses interval
 * intersection, not endpoint containment.
 */
function timelineOf(main, memoryId) {
  return main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(memoryId) ?? null;
}

function keywordTerms(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry)).filter(Boolean);
    } catch {
      // fall through: treat it as one literal keyword
    }
  }
  return value === null || value === undefined || value === '' ? [] : [String(value)];
}

function timeMatches(timeline, range) {
  if (!range) return true;
  const start = timeline?.start_at ?? null;
  const end = timeline?.end_at ?? null;
  const queryStart = validBound(range.start, 'start');
  const queryEnd = validBound(range.end, 'end');
  if (!queryStart && !queryEnd) return true;
  const state = timeline?.time_state ?? 'point';
  const s = start ? Date.parse(start) : null;
  const e = end ? Date.parse(end) : null;
  const qs = queryStart ? Date.parse(queryStart) : null;
  const qe = queryEnd ? Date.parse(queryEnd) : null;
  if (Number.isNaN(s) || Number.isNaN(e) || Number.isNaN(qs) || Number.isNaN(qe)) return false;
  if (state === 'point') {
    // A point event matches only when its own instant is inside the window.
    if (s === null) return false;
    if (qs !== null && s < qs) return false;
    if (qe !== null && s > qe) return false;
    return true;
  }
  // Intervals use overlap; a missing end never gets replaced by the query upper bound.
  if (s !== null && qe !== null && s > qe) return false;
  if (e !== null && qs !== null && e < qs) return false;
  return true;
}

export function searchMemories({
  main,
  clock,
  keywords = null,
  scene = null,
  topicKey = null,
  timeRange = null,
  graph = null,
  cursor = null,
  maxChars = DEFAULT_MAX_CHARS,
}) {
  const reading = clock.at().at;
  if (graph) {
    return {
      status: 'error',
      code: 'unsupported_feature',
      feature: 'graph',
      clock: reading,
    };
  }
  if (scene !== null && !['work', 'life', 'both'].includes(scene)) {
    return { status: 'error', code: 'validation_error', message: 'invalid_scene', clock: reading };
  }
  let rows;
  try {
    rows = main.prepare('SELECT * FROM memories ORDER BY recorded_at DESC, id ASC').all();
  } catch (err) {
    return { status: 'error', code: 'read_error', message: err.message, clock: reading };
  }

  const terms = keywordTerms(keywords).map((term) => normalizeText(term));
  const rankedQuery = terms.length <= 1 ? terms[0] ?? null : terms;
  const candidates = [];
  for (const row of rows) {
    if (scene && row.scene !== scene) continue;
    if (topicKey && row.topic_key !== topicKey) continue;
    const timeline = timelineOf(main, row.id);
    if (!timeMatches(timeline, timeRange)) continue;
    if (terms.length > 0) {
      const haystack = `${normalizeText(row.text)} ${normalizeText(row.detail ?? '')} ${normalizeText(row.why)}`;
      if (!terms.some((term) => haystack.includes(term))) continue;
    }
    const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(row.id) ?? null;
    candidates.push({ ...row, timeline, pointer });
  }

  const ranked = rankItems(candidates, {
    query: rankedQuery,
    now: new Date(reading),
  });
  const directHits = ranked.map(({ item }) => item);
  let evidenceMean = null;
  if (directHits.length > 0) {
    const scores = directHits.map((item) => {
      const pointer = item.pointer;
      const doorplate = pointer?.status === 'exact' ? 1 : pointer?.status === 'unknown' ? 0.35 : 0;
      const businessTime = item.timeline?.start_at ? 1 : 0;
      const useRow = main.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM uses WHERE memory_id = ?').get(item.id);
      const useScore = Math.min(Number(useRow?.n ?? 0) / 5, 1);
      const examScore = 0; // no exam capability in this batch
      return 0.4 * doorplate + 0.25 * businessTime + 0.2 * useScore + 0.15 * examScore;
    });
    evidenceMean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  }
  const queryKey = payloadHash({ keywords: rankedQuery, scene: scene ?? null, topicKey: topicKey ?? null, timeRange: timeRange ?? null });
  const resultHash = payloadHash(ranked.map(({ item }) => [item.id, item.payload_hash ?? null]));

  let startIndex = 0;
  if (cursor !== null) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (decoded.tool !== 'memsys_search' || decoded.v !== 1) {
        return { status: 'error', code: 'invalid_cursor', clock: reading };
      }
      if (decoded.queryKey !== queryKey || decoded.resultHash !== resultHash) {
        return { status: 'error', code: 'stale_cursor', clock: reading };
      }
      startIndex = Number(decoded.index ?? 0);
    } catch {
      return { status: 'error', code: 'invalid_cursor', clock: reading };
    }
  }

  const budget = clampChars(maxChars);
  const hits = [];
  const groupIndex = {};
  let used = 0;
  let index = startIndex;
  while (index < ranked.length) {
    const { item } = ranked[index];
    const entry = {
      id: item.id,
      text: item.text,
      scene: item.scene,
      scope: item.scope,
      semantic_status: item.semantic_status,
      credibility: item.credibility,
      due_state: item.due_state,
      topic_key: item.topic_key,
      time: item.timeline
        ? { start: item.timeline.start_at, end: item.timeline.end_at, time_state: item.timeline.time_state }
        : { start: null, end: null, time_state: 'point' },
      group: { topic_key: item.topic_key, key_status: String(item.topic_key ?? '').startsWith('tk:') ? 'resolved' : 'unresolved' },
    };
    const size = Array.from(entry.text ?? '').length + Array.from(entry.id).length;
    if (hits.length > 0 && used + size > budget) break;
    hits.push(entry);
    used += size;
    const key = entry.topic_key ?? '__unresolved__';
    groupIndex[key] = [...(groupIndex[key] ?? []), item.id];
    index += 1;
  }

  const nextCursor =
    index < ranked.length
      ? Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_search', index, queryKey, resultHash }), 'utf8').toString('base64url')
      : null;

  return {
    status: 'ok',
    hits,
    group_index: groupIndex,
    direct_hit_count: ranked.length,
    evidence_mean: evidenceMean,
    evidence_mean_status: directHits.length > 0 ? 'ok' : 'unavailable',
    evidence_formula: '0.40*doorplate+0.25*business_time+0.20*min(uses/5,1)+0.15*exam',
    relation_search: 'unavailable',
    relation_depth: graph ? null : 1,
    next_cursor: nextCursor,
    truncated: nextCursor !== null,
    clock: reading,
  };
}

export { pageText };
