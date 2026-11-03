import { canonicalJson } from '../identity.mjs';

/**
 * Origin graph and read-time credibility folding (design §12.4).
 * Credibility = min(self, every branch); from-dream < unverified < verified.
 */

const LEVEL = { verified: 2, unverified: 1, 'from-dream': 0 };
const MAX_DEPTH = 5;
const DREAM_TOKEN = /^d-[A-Za-z0-9]+#p\d+$/;

export function parseOriginTokens(originText) {
  if (Array.isArray(originText)) return originText;
  if (typeof originText !== 'string' || originText.length === 0) return [];
  if (originText.startsWith('[')) {
    try {
      const parsed = JSON.parse(originText);
      return Array.isArray(parsed) ? parsed.map(String) : [originText];
    } catch {
      return [originText];
    }
  }
  return [originText];
}

export function minLevel(a, b) {
  return LEVEL[a] <= LEVEL[b] ? a : b;
}

function resolveToken(db, token, depth) {
  if (depth > MAX_DEPTH) return 'unverified';
  if (typeof token !== 'string' || token.length === 0) return 'unverified';
  if (token.startsWith('master@') || token.startsWith('observed@')) return 'verified';
  if (token.startsWith('model:')) return 'unverified';
  if (token === 'migrated:whale-soul') return 'unverified';
  if (token === 'model_inference') return 'unverified';
  if (DREAM_TOKEN.test(token)) return 'from-dream';
  if (token.startsWith('file:')) {
    const [filePath, hash] = splitFileToken(token);
    if (!db || !filePath || !hash) return 'unverified';
    const row = db
      .prepare('SELECT origin FROM origins WHERE path = ? AND content_hash = ?')
      .get(filePath, hash);
    if (!row) return 'unverified';
    return foldOrigin(row.origin, { db, depth: depth + 1 }).credibility;
  }
  return 'unverified';
}

function splitFileToken(token) {
  const body = token.slice('file:'.length);
  const index = body.lastIndexOf('#');
  if (index <= 0) return [body, null];
  return [body.slice(0, index), body.slice(index + 1)];
}

/** Fold an origin into one credibility level plus the resolved token levels. */
export function foldOrigin(originText, { db = null, depth = 0 } = {}) {
  const tokens = parseOriginTokens(originText);
  if (tokens.length === 0) return { credibility: 'unverified', tokens: [], unsafe: true };
  let credibility = 'verified';
  const resolved = [];
  for (const token of tokens) {
    const level = resolveToken(db, token, depth);
    resolved.push({ token, level });
    credibility = minLevel(credibility, level);
  }
  return { credibility, tokens: resolved, unsafe: false };
}

/** Compose the service-owned origin for a model candidate from its evidence. */
export function composeCandidateOrigin(db, evidenceRows, modelToken) {
  const tokens = [];
  for (const evidence of evidenceRows ?? []) {
    if (!evidence.observation_id) continue;
    const observation = db
      .prepare('SELECT origin FROM observations WHERE id = ?')
      .get(evidence.observation_id);
    if (observation) {
      for (const token of parseOriginTokens(observation.origin)) tokens.push(token);
    }
  }
  tokens.push(modelToken, 'model_inference');
  return canonicalJson([...new Set(tokens)].sort());
}

export function credibilityOf(db, originText) {
  return foldOrigin(originText, { db }).credibility;
}
