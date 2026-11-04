/**
 * 0.3.1 复测 · 判分器（口径写死，别自己发明；纯规则见 eval/must-match.mjs）
 *
 * 每题按 eval/questions-codex.json 的 must 事实点判：单点命中 = 下面任一
 *   1. 连续片段：答案里出现变体的连续 ≥4 字片段（归一化、去标点后比较）；
 *   2. 二元组召回：变体二元组在答案里的召回率 ≥ 0.45。
 * 说明：0.3.0 的 28/52 是人工抽检后的结果，脚本无法逐行复原（差 4 个 must 点）；
 * 为了可比，旧答案（eval/answers20-c.json）用同一脚本重判一份，两个数都写进 EVAL.md。
 *
 * 跑法：
 *   node eval/grade.mjs --answers eval/answers20-c-031.json --out eval/scores20-031.json
 *   node eval/grade.mjs --answers eval/answers20-c.json --out eval/scores20-c-regraded.json --label c-regraded
 */
import fs from 'node:fs';

import { questionCoverage } from './must-match.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const ANS_FILE = getArg('answers', 'eval/answers20-c-031.json');
const OUT_FILE = getArg('out', 'eval/scores20-031.json');
const LABEL = getArg('label', 'c-031');

const questions = JSON.parse(fs.readFileSync('eval/questions-codex.json', 'utf8')).questions;
const byId = new Map(questions.map((question) => [question.id, question]));

const answers = JSON.parse(fs.readFileSync(ANS_FILE, 'utf8'));
const rows = [];
let got = 0;
let total = 0;
for (const entry of answers) {
  const question = byId.get(entry.id);
  if (!question) throw new Error(`unknown question: ${entry.id}`);
  const coverage = questionCoverage(question, entry.answer);
  rows.push({ id: question.id, k: entry.k ?? 'C', got: coverage.got, total: coverage.total });
  got += coverage.got;
  total += coverage.total;
}

const summary = {
  label: LABEL,
  answers: ANS_FILE,
  rule: 'contiguous>=4chars OR bigram_recall>=0.45',
  coverage: { got, total, ratio: Number((got / total).toFixed(4)) },
  rows,
};
fs.writeFileSync(OUT_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
const zeros = rows.filter((row) => row.got === 0).map((row) => row.id);
console.log(`${LABEL}: ${got}/${total} = ${((got / total) * 100).toFixed(1)}%  -> ${OUT_FILE}`);
if (zeros.length > 0) console.log(`zero-got: ${zeros.join(',')}`);
