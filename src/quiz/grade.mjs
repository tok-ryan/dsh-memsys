/**
 * 判卷：复述题（pick）与辨伪题（challenge）都在这里算分。
 *
 * 搬自 echo-plugin `src/index.js:116-145,147-163,321-328` 与 `src/challenge.js:81-102`
 * （只读备份 `echo-plugin.bak-20261103`），公式与阈值逐字保留：
 *   score = cover * 0.7 + sim * 0.3      cover = 硬料/bigram 覆盖率，sim = 中文二元组 Jaccard
 *   hardBits 6 类硬料：日期 / 带单位数字 / 书名号 / 直角引号 / 双引号 / 大写缩写
 *   judgeChallenge 三信号（提到正确写法 / 指向该类改动 / 明说错了），命中 >= 2 算挑出来
 *
 * 纯函数、只出分：不写库、不加 uses、不改 verdict（echo 的老边界，原样保留）。
 */

const HARD_BIT_PATTERNS = [
  /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/g,
  /\d+(?:\.\d+)?\s*(?:元|块|kg|公斤|克|g|ml|小时|分钟|天|条|次|岁|度|%)/g,
  /《[^》]{2,40}》/g,
  /「[^」]{2,40}」/g,
  /"([^"]{2,40})"/g,
  /\b[A-Z]{2,}(?:[-_][A-Za-z0-9]+)*\b/g,
];

const KIND_HINTS = {
  date: /日期|时间|哪天|什么时候|月|日/,
  number: /数字|多少|几|分钟|小时|条|个|天/,
  flip: /反|否定|相反|不是|否/,
  subject: /谁|主体|不是他|是主人|是我/,
};

const KIND_LABELS = { date: '日期', number: '数字', flip: '意思反了', subject: '主体' };

const PROBLEM_WORDS = /错|不对|有问题|改过|假的|不实/;

/** 去标点（echo 原字符集）+ 小写。 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[，。！？、；：""''（）《》【】\s,.!?;:()[\]{}"'`~·—…]/g, '')
    .toLowerCase();
}

/** 中文二元组集合；没有二元组但有单字时保留该单字。 */
export function bigrams(text) {
  const points = Array.from(normalize(text));
  const grams = new Set();
  for (let index = 0; index + 1 < points.length; index += 1) {
    grams.add(points[index] + points[index + 1]);
  }
  if (grams.size === 0 && points.length === 1) grams.add(points[0]);
  return grams;
}

/** sim：Jaccard；任一侧为空 -> 0。全同 = 1，无关 = 0。 */
export function jaccard(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const gram of left) if (right.has(gram)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** cover：ref 的 bigram 被 recall 覆盖的比例（ref 为空返回 1，echo 原语义）。 */
export function coverage(ref, recall) {
  const reference = bigrams(ref);
  const reply = bigrams(recall);
  if (reference.size === 0) return 1;
  let hit = 0;
  for (const gram of reference) if (reply.has(gram)) hit += 1;
  return hit / reference.size;
}

/** 6 类硬料抽取，去重后返回数组（引号/书名号已剥掉）。 */
export function hardBits(text) {
  const out = new Set();
  const source = String(text ?? '');
  for (const pattern of HARD_BIT_PATTERNS) {
    const matches = source.match(pattern);
    if (matches) for (const match of matches) out.add(match.replace(/["《》「」]/g, ''));
  }
  return [...out];
}

/**
 * 复述题判卷。ref 为空时直接给 0（否则 echo 的 coverage 会给 cover=1，凭空 0.7 分）。
 * @returns {{ score: number, cover: number, sim: number, hits: string[], missing: string[], invented: string[] }}
 */
export function gradePick(refText, answer) {
  const ref = String(refText ?? '');
  const reply = String(answer ?? '');
  if (ref.length === 0) return { score: 0, cover: 0, sim: 0, hits: [], missing: [], invented: [] };

  const replyNormalized = normalize(reply);
  const refNormalized = normalize(ref);
  const refBits = hardBits(ref);
  const hits = refBits.filter((bit) => replyNormalized.includes(normalize(bit)));
  const missing = refBits.filter((bit) => !replyNormalized.includes(normalize(bit)));
  const invented = hardBits(reply).filter((bit) => !refNormalized.includes(normalize(bit)));

  const cover = coverage(ref, reply);
  const sim = jaccard(ref, reply);
  const score = Math.max(0, Math.min(1, cover * 0.7 + sim * 0.3));
  return { score, cover, sim, hits, missing, invented };
}

/**
 * 辨伪题判卷：三信号命中 >= 2 算挑出来。
 * @param {string} answer 我的回答
 * @param {{ truth?: string, kind?: string }} tampered tamper() 的返回
 * @returns {{ ok: boolean, hit: boolean, signals: string[] }}
 */
export function judgeChallenge(answer, tampered) {
  const reply = String(answer ?? '');
  const reference = tampered ?? {};
  if (reply.trim().length === 0) return { ok: false, hit: false, signals: [] };

  const signals = [];
  const truth = String(reference.truth ?? '');
  if (truth && reply.includes(truth)) signals.push(`提到了正确写法「${truth}」`);

  const hint = KIND_HINTS[reference.kind];
  if (hint && hint.test(reply)) signals.push(`指向了${KIND_LABELS[reference.kind] ?? '改动'}这一处`);

  if (PROBLEM_WORDS.test(reply)) signals.push('指出了这处有问题');

  const hit = signals.length >= 2;
  return { ok: hit, hit, signals };
}
