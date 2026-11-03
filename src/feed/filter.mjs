const POLICY_REVISION = 'feed-v1';
const DEFAULT_RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_DAYS = 7;

const UNIT_PATTERN = '%|％|GB|MB|TB|ms|分钟|小时|秒|s|天|元|万|亿';

function nfkcLower(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase();
}

function codePointRange(text, index, length) {
  const start = Array.from(text.slice(0, index)).length;
  return [start, start + Array.from(text.slice(index, index + length)).length];
}

function scanDetails(field, text, matches) {
  if (typeof text !== 'string' || text.length === 0) return;

  const tokenPattern = /(?<![A-Za-z0-9])[A-Za-z]{3,}(?![A-Za-z0-9])/g;
  for (const match of text.matchAll(tokenPattern)) {
    matches.push({ type: 'token', field, text: match[0], range: codePointRange(text, match.index, match[0].length) });
  }

  const versionPattern = /(?<![A-Za-z0-9])[vV]?\d+(?:\.\d+)+(?:[-+]?[A-Za-z0-9]+)?(?![A-Za-z0-9])/g;
  for (const match of text.matchAll(versionPattern)) {
    matches.push({ type: 'version', field, text: match[0], range: codePointRange(text, match.index, match[0].length) });
  }

  const unitPattern = new RegExp(
    `(?<![\\d.])\\d+(?:\\.\\d+)?\\s?(?:${UNIT_PATTERN})(?![A-Za-z0-9])`,
    'gu',
  );
  for (const match of text.matchAll(unitPattern)) {
    matches.push({ type: 'unit', field, text: match[0], range: codePointRange(text, match.index, match[0].length) });
  }

  const bookPattern = /《([^》]*)》/g;
  for (const match of text.matchAll(bookPattern)) {
    if (match[1].trim().length === 0) continue;
    matches.push({ type: 'book', field, text: match[0], range: codePointRange(text, match.index, match[0].length) });
  }
}

function validIsoWithZone(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== undefined && match[7].length > 3) return null;
  const zone = match[8];
  if (zone !== 'Z') {
    const [zh, zm] = zone.slice(1).split(':').map(Number);
    if (zh > 23 || zm > 59) return null;
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  return epoch;
}

/**
 * Pure feed filter. Three gates in fixed order: relevance -> details -> time.
 * No database access, no observation/memory/uses writes.
 */
export function filterFeed({ items, keywords, recentDays = DEFAULT_RECENT_DAYS, now, policyRevision = POLICY_REVISION }) {
  if (!Array.isArray(items)) return { status: 'error', code: 'items_invalid' };
  if (!Array.isArray(keywords) || keywords.length === 0 || keywords.some((word) => typeof word !== 'string' || word.trim().length === 0)) {
    return { status: 'error', code: 'keywords_unavailable' };
  }
  const days = Number(recentDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_RECENT_DAYS) {
    return { status: 'error', code: 'feed_window_invalid', recentDays };
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { status: 'error', code: 'now_invalid' };
  }
  const nowMs = now.getTime();
  const normalizedKeywords = keywords.map((word) => nfkcLower(word));

  const seen = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string') return { status: 'error', code: 'item_id_missing' };
    const signature = JSON.stringify([item.title ?? null, item.description ?? null, item.publishedAt ?? null]);
    if (seen.has(item.id) && seen.get(item.id) !== signature) {
      return { status: 'error', code: 'duplicate_id_conflict', id: item.id };
    }
    seen.set(item.id, signature);
  }

  const results = items.map((item) => {
    const title = typeof item.title === 'string' ? item.title : '';
    const description = typeof item.description === 'string' ? item.description : '';
    const titleNorm = nfkcLower(title);
    const matchedKeywords = [];
    normalizedKeywords.forEach((keyword, index) => {
      if (titleNorm.includes(keyword) && !matchedKeywords.includes(keywords[index])) matchedKeywords.push(keywords[index]);
    });

    const detailMatches = [];
    scanDetails('title', title, detailMatches);
    scanDetails('description', description, detailMatches);

    const reasons = [];
    if (matchedKeywords.length === 0) reasons.push('not_relevant');
    if (detailMatches.length === 0) reasons.push('no_details');

    const rawPublished = item.publishedAt;
    if (rawPublished === undefined || rawPublished === null || rawPublished === '') {
      reasons.push('missing_publish_time');
    } else {
      const epoch = validIsoWithZone(rawPublished);
      if (epoch === null) {
        reasons.push('invalid_publish_time');
      } else if (epoch > nowMs) {
        reasons.push('future_publish_time');
      } else if (epoch < nowMs - days * DAY_MS) {
        reasons.push('too_old');
      }
    }

    return {
      id: item.id,
      title: item.title ?? null,
      description: item.description ?? null,
      publishedAt: rawPublished ?? null,
      accepted: reasons.length === 0,
      matchedKeywords,
      detailMatches,
      rejectionReasons: reasons,
      now: new Date(nowMs).toISOString(),
      recentDays: days,
      policyRevision,
      window: { start: new Date(nowMs - days * DAY_MS).toISOString(), end: new Date(nowMs).toISOString() },
    };
  });

  return {
    status: 'ok',
    now: new Date(nowMs).toISOString(),
    recentDays: days,
    policyRevision,
    items: results,
    accepted: results.filter((item) => item.accepted).map((item) => item.id),
    rejected: results.filter((item) => !item.accepted).map((item) => item.id),
  };
}

export { POLICY_REVISION, DEFAULT_RECENT_DAYS, MAX_RECENT_DAYS, validIsoWithZone };
