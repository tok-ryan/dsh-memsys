/**
 * 0.3.1 复测 · 生成 C 配置 prompts（只跑 C，A/B 基线沿用 docs/EVAL.md 的旧数据）
 *
 * C 配置定义：走 memsys 检索层 `searchMemories({ keywords: 原问句 })` → top-5 →
 * 回库补 type/weight/recorded_at/why/detail → 旧 C 模板（与 0.3.0 的 eval/build-prompts.mjs 一致）。
 * 与旧 C 的差别：检索从「BM25 top5」改成「真实检索层 top5」——这正是 0.3.1 要验证的东西。
 *
 * 跑法：node eval/build-c-prompts.mjs [--data ~/.dsh/memsys] [--out eval/q031]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase } from '../src/storage/open.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { loadAliases, setAliasProvider } from '../src/read/expand.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const DATA_DIR = getArg('data', path.join(os.homedir(), '.dsh', 'memsys'));
const OUT_DIR = getArg('out', path.join('eval', 'q031'));
const TOP_K = 5;

const questions = JSON.parse(fs.readFileSync('eval/questions-codex.json', 'utf8')).questions;
const main = openDatabase(path.join(DATA_DIR, 'memsys.db'));
setAliasProvider(() => loadAliases(DATA_DIR));

const clock = { at: () => ({ at: '2026-11-04T00:00:00.000Z' }) };
const metaRows = new Map(
  main.prepare('SELECT id, type, weight, recorded_at, text, why, detail FROM memories').all().map((row) => [row.id, row]),
);

fs.mkdirSync(OUT_DIR, { recursive: true });
const index = [];
let goldTotal = 0;
let goldHit = 0;
for (const question of questions) {
  const result = searchMemories({ main, clock, keywords: question.ask, maxChars: 8000 });
  if (result.status !== 'ok') throw new Error(`${question.id} search failed: ${JSON.stringify(result)}`);
  const hits = result.hits.slice(0, TOP_K).map((hit) => metaRows.get(hit.id)).filter(Boolean);
  const gold = new Set(question.gold_memory_ids || []);
  const hitsGold = hits.filter((row) => gold.has(row.id)).length;
  goldTotal += gold.size;
  goldHit += hitsGold;

  const meta = (row) =>
    `- [${row.type} · 权重${row.weight ?? '?'} · ${String(row.recorded_at).slice(0, 10)}]\n  原文：${row.text}\n  为什么记：${row.why || '（无）'}`;
  const prompt = [
    '你是助手。只依据下面给出的“记忆”回答这个问题，2~4 句，直接给结论；记忆里没有的就说不确定，不要编。',
    '',
    `记忆：\n${hits.map(meta).join('\n') || '（没有检索到相关记忆）'}`,
    '',
    `问题：${question.ask}`,
    '',
    '只输出答案本身。',
  ].join('\n');
  const file = path.join(OUT_DIR, `${question.id}-C.md`);
  fs.writeFileSync(file, prompt, 'utf8');
  index.push({ id: question.id, k: 'C', file: path.resolve(file), hit_ids: hits.map((row) => row.id), gold_hits: hitsGold, direct_hit_count: result.direct_hit_count });
}

const summary = {
  dataDir: DATA_DIR,
  generated_at: '2026-11-04T00:00:00.000Z',
  retrieval: 'searchMemories(keywords=ask, top5)',
  recall: { gold: goldTotal, hit: goldHit },
  index,
};
fs.writeFileSync(path.join(OUT_DIR, 'retrieval.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`prompts: ${index.length} -> ${OUT_DIR}`);
console.log(`recall: ${goldHit}/${goldTotal} (${((goldHit / goldTotal) * 100).toFixed(0)}%)`);
main.close();
