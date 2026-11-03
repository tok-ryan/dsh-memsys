const DAY_MS = 24 * 60 * 60 * 1000;

/** NFKC, lowercase, punctuation/space removal; codepoint bigrams (single char kept). */
export function normalizeLiteral(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

export function bigramSet(text) {
  const normalized = normalizeLiteral(text);
  if (!normalized) return new Set();
  const points = Array.from(normalized);
  if (points.length === 1) return new Set(points);
  const grams = new Set();
  for (let index = 0; index < points.length - 1; index += 1) {
    grams.add(points[index] + points[index + 1]);
  }
  return grams;
}

export function buildLexicalStats(items) {
  const df = new Map();
  for (const item of items) {
    for (const gram of bigramSet(item.text)) {
      df.set(gram, (df.get(gram) ?? 0) + 1);
    }
  }
  return { N: items.length, df };
}

function idf(stats, gram) {
  const df = stats.df.get(gram) ?? 0;
  return 1 + Math.log((stats.N + 1) / (df + 1));
}

/** L = sum(idf of intersection) / sum(idf of union), clamped to [0, 1]. */
export function literalOverlap(query, text, stats) {
  const queryGrams = bigramSet(query);
  if (queryGrams.size === 0) return 0;
  const docGrams = bigramSet(text);
  if (docGrams.size === 0) return 0;
  let intersection = 0;
  let union = 0;
  const grams = new Set([...queryGrams, ...docGrams]);
  for (const gram of grams) {
    const weight = idf(stats, gram);
    union += weight;
    if (queryGrams.has(gram) && docGrams.has(gram)) intersection += weight;
  }
  if (union === 0) return 0;
  return Math.min(1, Math.max(0, intersection / union));
}

/** Tags of the form topic:…; a hit means the tag body appears in the query. */
export function tagHitRatio(tagsText, query) {
  let tags = [];
  try {
    tags = JSON.parse(tagsText ?? '[]');
  } catch {
    tags = [];
  }
  const topicTags = tags.filter((tag) => typeof tag === 'string' && tag.startsWith('topic:'));
  if (topicTags.length === 0) return 0;
  const normalizedQuery = normalizeLiteral(query);
  const hits = topicTags.filter((tag) =>
    normalizedQuery.includes(normalizeLiteral(tag.slice('topic:'.length))),
  ).length;
  return hits / topicTags.length;
}

export function halfLifeDays(weight) {
  if (weight <= 3) return 15;
  if (weight <= 7) return 30;
  return 90;
}

export function freshness(item, nowMs) {
  const lastTouched = Date.parse(item.last_touched_at ?? item.recorded_at);
  const ageDays = Math.max(0, (nowMs - lastTouched) / DAY_MS);
  const strength = Number(item.initial_strength ?? 0.5);
  return strength * 2 ** (-ageDays / halfLifeDays(Number(item.weight ?? 5)));
}

/**
 * R = 0.5·tag + 0.3·literal + 0.2·freshness; R_eff = R × F.
 * Sorting never drops an item: relevance is order and summary length only.
 */
export function rankItems(items, { query = null, now = new Date(), feedback = () => 1 } = {}) {
  const nowMs = now.getTime();
  const stats = buildLexicalStats(items);
  const scored = items.map((item) => {
    const tags = tagHitRatio(item.tags, query ?? '');
    const literal = literalOverlap(query ?? '', item.text, stats);
    const fresh = freshness(item, nowMs);
    const R = 0.5 * tags + 0.3 * literal + 0.2 * fresh;
    const F = feedback(item);
    return { item, R, F, R_eff: R * F, freshness: fresh };
  });
  scored.sort((a, b) => {
    if (query) {
      if (b.R_eff !== a.R_eff) return b.R_eff - a.R_eff;
      const at = Date.parse(b.item.recorded_at);
      const bt = Date.parse(a.item.recorded_at);
      if (at !== bt) return at - bt;
    } else {
      if (b.freshness !== a.freshness) return b.freshness - a.freshness;
      if (Number(b.item.weight) !== Number(a.item.weight)) {
        return Number(b.item.weight) - Number(a.item.weight);
      }
    }
    return String(a.item.id).localeCompare(String(b.item.id));
  });
  return scored;
}

/** Feedback multiplier from consecutive unused counts. */
export function feedbackFactor(unusedStreak) {
  if (unusedStreak < 3) return 1;
  return 0.5 ** (unusedStreak - 2);
}
