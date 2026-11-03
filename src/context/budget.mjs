export const SOFT_BUDGET_CODE_POINTS = 3200;
export const COMPRESSION_STEPS = Object.freeze([40, 20, 8]);
export const MAX_TOP_GROUPS = 12;

export function codePoints(text) {
  return Array.from(String(text)).length;
}

export function utf8Bytes(text) {
  return Buffer.byteLength(String(text), 'utf8');
}

/**
 * Test-only conservative upper bound. Production never substitutes bytes for
 * tokens: without a host tokenizer the organ stays tools-only.
 */
export function conservativeTokens(text) {
  return Math.ceil(codePoints(text) / 2);
}

export function measure(text, tokenizer) {
  return {
    codePoints: codePoints(text),
    bytes: utf8Bytes(text),
    tokens: tokenizer ? tokenizer(text) : null,
  };
}

export function truncateCodePoints(text, max) {
  const points = Array.from(String(text));
  if (points.length <= max) return String(text);
  return `${points.slice(0, Math.max(0, max - 1)).join('')}…`;
}

export function shortTime(value) {
  if (!value) return 'unknown';
  return String(value).slice(0, 16).replace('T', ' ');
}

/** One directory entry: id, short conclusion, business time, labels, group mark. */
export function directoryLine(item, maxCodePoints = 80) {
  const summary = truncateCodePoints(item.text, Math.max(8, maxCodePoints));
  const time = shortTime(item.business_start);
  const labels = [item.semantic_status, item.credibility];
  if (item.conflict_marker) labels.push('分歧');
  const group = item.category === 'registered' ? `组:${item.topic_key.slice(0, 18)}` : '未归组';
  return `${item.id} · ${summary} · ${time} · ${labels.join('/')} · ${group}`;
}

export function sumMeasures(texts, tokenizer) {
  let cp = 0;
  let bytes = 0;
  let tokens = 0;
  for (const text of texts) {
    cp += codePoints(text);
    bytes += utf8Bytes(text);
    tokens += tokenizer ? tokenizer(text) : 0;
  }
  return { codePoints: cp, bytes, tokens };
}

export function joinLines(lines) {
  return lines.join('\n');
}

/**
 * K = fixed header + status line (+ group headers in grouped mode). K is always
 * charged to the hard layer and never counted as a member.
 */
export function measureK({ fixedText, statusText, groupHeaders = [], tokenizer }) {
  const texts = [fixedText, statusText, ...groupHeaders];
  const measured = sumMeasures(texts, tokenizer);
  return { ...measured, memberCount: 0 };
}

export function groupHeader(group, snapshotRevision) {
  return `${group.name}（${group.groupId}）：未展开 ${group.members.length} 条；memsys_context_get(snapshot_revision=${snapshotRevision}, group_id=${group.groupId}, cursor=null, max_chars=8000)`;
}
