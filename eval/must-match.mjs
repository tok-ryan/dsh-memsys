/**
 * 判分口径的纯函数（eval/grade.mjs 与离线 must-上限核对共用）。
 * 规则写死在 docs/EVAL.md：命中 ≥4 字连续片段，或变体二元组召回 ≥0.45。
 */
export const CONTIG_MIN = 4;
export const BIGRAM_MIN = 0.45;

const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase();
export const stripLiteral = (value) => normalize(value).replace(/[\p{P}\p{S}\s]/gu, '');

export function bigrams(text) {
  const points = Array.from(stripLiteral(text));
  if (points.length === 0) return new Set();
  if (points.length === 1) return new Set(points);
  const grams = new Set();
  for (let index = 0; index < points.length - 1; index += 1) grams.add(points[index] + points[index + 1]);
  return grams;
}

export function bigramRecall(variant, answerText) {
  const variantGrams = bigrams(variant);
  if (variantGrams.size === 0) return 0;
  const answerGrams = bigrams(answerText);
  let hit = 0;
  for (const gram of variantGrams) if (answerGrams.has(gram)) hit += 1;
  return hit / variantGrams.size;
}

export function mustHit(variant, answer) {
  const needle = stripLiteral(variant);
  const haystack = stripLiteral(answer);
  if (Array.from(needle).length >= CONTIG_MIN && haystack.includes(needle)) return true;
  return bigramRecall(variant, answer) >= BIGRAM_MIN;
}

export function questionCoverage(question, answer) {
  let got = 0;
  for (const must of question.must) {
    if (must.variants.some((variant) => mustHit(variant, answer))) got += 1;
  }
  return { got, total: question.must.length };
}
