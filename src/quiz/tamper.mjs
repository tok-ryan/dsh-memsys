/**
 * 辨伪题改写：把一条真记忆改坏一处，考「记没记住」而不是「背得像不像」。
 *
 * 算法搬自 echo-plugin `src/challenge.js:21-78`（只读备份 `echo-plugin.bak-20261103`），
 * 行为逐字保留，只做两处整理：
 *   1. 删掉原文件里声明了却从未被引用的 `NUM_WORDS` 死表（文档误读的 43→34 就出自这张表）；
 *   2. 返回值补 `text`（原文）；`fake` 仍是「改坏后的整段文本」，与 echo 语义一致。
 *
 * 四类改法按 date → number → flip → subject 短路，命中即返回；每类只改一个点、答案唯一。
 * 纯函数：不碰 fs / sqlite / 时间 / 随机数，同一输入永远同一输出。
 */

export const TAMPER_KINDS = ['date', 'number', 'flip', 'subject'];

const FLIP_PAIRS = [
  ['不用', '要'],
  ['不要', '要'],
  ['不能', '能'],
  ['不准', '准'],
  ['不喜欢', '喜欢'],
  ['不想', '想'],
  ['别', '要'],
  ['没', '有'],
];

const SUBJECT_PAIRS = [
  ['主人', '我'],
  ['我', '主人'],
];

const NUMBER_PATTERN = /(\d+)(\s*(?:分钟|小时|条|个|天|岁|元|块|%))/;

function changed(kind, original, fake, truth, note) {
  return { kind, text: original, fake, truth, note };
}

/** 只替换第一次出现的 token；找不到返回 null（与 echo 的 indexOf + slice 等价）。 */
function singleSwap(original, token, replacement) {
  const index = original.indexOf(token);
  if (index < 0) return null;
  return original.slice(0, index) + replacement + original.slice(index + token.length);
}

/**
 * @param {string} text 原文（记忆的 raw）
 * @returns {null | { kind: 'date'|'number'|'flip'|'subject', text: string, fake: string, truth: string, note: string }}
 *   null = 这一条没有能改坏的点，调用方应换一条
 */
export function tamper(text) {
  const original = String(text ?? '');
  if (original.length === 0) return null;

  // 1) 日期：2026-10-28 → 2026-10-01（日不是 1 就改 01，是 1 就改 02）
  let match = original.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const day = String(Number(match[3]) === 1 ? 2 : 1).padStart(2, '0');
    const fakeToken = match[0].replace(`-${match[3]}`, `-${day}`);
    return changed('date', original, original.replace(match[0], fakeToken), match[0], `日期从 ${match[0]} 改成了 ${fakeToken}`);
  }

  // 2) 日期：10月28日 → 10月1日
  match = original.match(/(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const day = Number(match[2]) === 1 ? 2 : 1;
    const fakeToken = `${match[1]}月${day}日`;
    return changed('date', original, original.replace(match[0], fakeToken), match[0], `日期从 ${match[0]} 改成了 ${fakeToken}`);
  }

  // 3) 数字：43分钟 → 22分钟（n=1 改 2；否则砍半，砍半等于自己就 +1）
  match = original.match(NUMBER_PATTERN);
  if (match) {
    const n = Number(match[1]);
    const half = Math.max(1, Math.round(n / 2));
    const fakeN = n === 1 ? 2 : half === n ? n + 1 : half;
    const fakeToken = `${fakeN}${match[2]}`;
    return changed('number', original, original.replace(match[0], fakeToken), match[0], `数字从 ${match[1]} 改成了 ${fakeN}`);
  }

  // 4) 否定翻转：意思整个反了，最容易骗人
  for (const [from, to] of FLIP_PAIRS) {
    const fake = singleSwap(original, from, to);
    if (fake !== null) return changed('flip', original, fake, from, `「${from}」被改成了「${to}」——意思整个反了`);
  }

  // 5) 主体替换：主人 ↔ 我
  for (const [from, to] of SUBJECT_PAIRS) {
    const fake = singleSwap(original, from, to);
    if (fake !== null) return changed('subject', original, fake, from, `主体从「${from}」换成了「${to}」`);
  }

  return null;
}
