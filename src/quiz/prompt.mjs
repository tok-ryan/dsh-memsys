/**
 * 题面：复述题（pick）与辨伪题（challenge）。
 *
 * pick 的硬口径（decisions D3）：
 *   - 「我的理解」用 `entry.gist`（source.mjs 里填 `why`，不是 text）；
 *   - `title` 不进题面——memsys 的 title 是 text 前 16 字，写上去等于白送 cover；
 *   - `raw` 绝不出现；gist 与 raw 有 >= 12 字连续重合就换占位（防泄漏闸）。
 * challenge 贴的是「被改坏的那段」——它本身就是题目，不适用 pick 的泄漏闸。
 *
 * 纯字符串拼接：不落盘、不取时间、不取随机数。
 */

import { normalize } from './grade.mjs';

const LEAK_WINDOW = 12;
const REDACTED = '（「我的理解」与原文重合太多，已隐去）';
const EMPTY_GIST = '（这条没有留下「当初为什么记下」的理由）';
const LEAK_FALLBACK = [
  '【考题】（这条题面能给的信息太少，先凭印象复述即可）',
  '',
  '别翻原话。先凭印象把它复述一遍，再用 memsys_quiz mode=submit 交卷。',
].join('\n');

/** field 里是否藏着 raw 的连续片段（>= LEAK_WINDOW 字，raw 更短则整段比）。 */
function leaks(field, rawNormalized) {
  const text = normalize(field);
  if (text.length === 0 || rawNormalized.length === 0) return false;
  if (text === rawNormalized) return true;
  const size = Math.min(LEAK_WINDOW, rawNormalized.length);
  for (let index = 0; index + size <= rawNormalized.length; index += 1) {
    if (text.includes(rawNormalized.slice(index, index + size))) return true;
  }
  return false;
}

function safeGist(entry, rawNormalized) {
  const gist = String(entry.gist ?? '').trim();
  if (gist.length === 0) return EMPTY_GIST;
  return leaks(gist, rawNormalized) ? REDACTED : gist;
}

function safeTags(entry, rawNormalized) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  return tags.map((tag) => String(tag)).filter((tag) => !leaks(tag, rawNormalized));
}

/**
 * 复述题题面：元信息 + 「我的理解」，不含 title、不含 raw。
 * @param {{ gist?: string, raw?: string, type?: string, scene?: string, tags?: string[], createdAt?: string, at?: string }} entry
 * @returns {string}
 */
export function buildPickPrompt(entry) {
  const safeEntry = entry ?? {};
  const rawNormalized = normalize(String(safeEntry.raw ?? ''));
  const tags = safeTags(safeEntry, rawNormalized);

  const meta = [];
  if (safeEntry.type) meta.push(`类型：${safeEntry.type}`);
  if (safeEntry.scene) meta.push(`场景：${safeEntry.scene}`);
  if (tags.length > 0) meta.push(`标签：${tags.join(' ')}`);
  const at = safeEntry.createdAt || safeEntry.at;
  if (at) meta.push(`记录时间：${at}`);

  const lines = ['【考题】（复述练习）'];
  if (meta.length > 0) lines.push(meta.join('｜'), '');
  lines.push('—— 我知道的（我的理解，不是原话）：', safeGist(safeEntry, rawNormalized), '');
  lines.push('别翻原话。先凭印象把它复述一遍，再用 memsys_quiz mode=submit 交卷。');

  const prompt = lines.join('\n');
  return rawNormalized && normalize(prompt).includes(rawNormalized) ? LEAK_FALLBACK : prompt;
}

/**
 * 辨伪题题面：只给被改坏的那一段 + 「指出哪儿不对」。
 * `entry` 目前只用于调用方对齐签名（题面不出现 title / id）；`tampered` 为 tamper() 的返回。
 * @param {object} entry
 * @param {{ fake?: string, text?: string }} tampered
 * @returns {string}
 */
export function buildChallengePrompt(entry, tampered) {
  const fake = String(tampered?.fake ?? tampered?.text ?? '').trim();
  if (fake.length === 0) throw new TypeError('buildChallengePrompt: tampered.fake 不能为空');

  return [
    '【辨伪题】下面这段话来自我的一条记忆，但被我改坏了一处。',
    '把它挑出来，指出哪儿不对——说不出来就是没记住。',
    '',
    `「${fake}」`,
    '',
    '用 memsys_quiz mode=submit answer="…" 交卷。',
  ].join('\n');
}
