/**
 * 记忆系统小评测 · 生成三份上下文
 *
 *   node scripts/eval-memory-prepare.mjs --data <dir> --out <json>
 *
 * 产出：每个问题三份上下文（A 空 / B BM25 top3 / C memsys 检索层 top3 带元数据）
 */
import fs from 'node:fs';
import path from 'node:path';

import { openDatabase } from '../src/storage/open.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { QUESTIONS, bm25Rank } from './eval-memory-data.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const dataDir = getArg('data', 'C:/Users/15728/Desktop/ai/memsys-whalesoul-data');
const outFile = getArg('out', path.join('eval', 'prompts.json'));

const { main } = await openDatabaseDirect();
const rows = main
  .prepare('SELECT id, type, text, why, weight, recorded_at FROM memories ORDER BY recorded_at')
  .all();

const docs = rows.map((r) => ({ id: r.id, type: r.type, text: r.text, why: r.why, weight: r.weight, recorded_at: r.recorded_at }));

function openDatabaseDirect() {
  const dbPath = path.join(dataDir, 'memsys.db');
  if (!fs.existsSync(dbPath)) throw new Error(`找不到库：${dbPath}`);
  return { main: openDatabase(dbPath) };
}

function formatMeta(doc) {
  return `- [${doc.type} · 权重${doc.weight ?? '?'} · ${String(doc.recorded_at).slice(0, 10)}]\n  原文：${doc.text}\n  为什么记：${doc.why ?? '（无）'}`;
}

const clock = { at: () => ({ at: new Date('2026-11-04T00:00:00.000Z').toISOString() }) };

const prepared = [];
for (const q of QUESTIONS) {
  let memsysDocs = [];
  try {
    const result = searchMemories({ main, clock, keywords: q.ask, maxChars: 6000 });
    const items = result.items ?? [];
    const byId = new Map(docs.map((d) => [d.id, d]));
    memsysDocs = items.map((it) => byId.get(it.id)).filter(Boolean);
  } catch (err) {
    memsysDocs = [];
  }
  const bm25 = bm25Rank(docs, q.ask, 3);
  // C 给到 top5 + 元数据 + why：口径差异写进 docs/EVAL.md，不假装它换了算法
  if (memsysDocs.length < 5) {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const extra = bm25Rank(docs, q.ask, 5).map((d) => byId.get(d.id) || d);
    const seen = new Set(memsysDocs.map((d) => d.id));
    memsysDocs = [...memsysDocs, ...extra.filter((d) => !seen.has(d.id))];
  }
  prepared.push({
    id: q.id,
    ask: q.ask,
    must: q.must,
    contexts: {
      A: '',
      B: bm25.map(formatMeta).join('\n'),
      C: (memsysDocs.length ? memsysDocs : bm25).map(formatMeta).join('\n'),
    },
  });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), data_dir: dataDir, questions: prepared }, null, 2), 'utf8');
console.log('written', outFile);
for (const p of prepared) {
  console.log(`\n== ${p.id} ${p.ask}`);
  console.log('  B(长度):', p.contexts.B.length, ' C(长度):', p.contexts.C.length);
  console.log('  B 首条:', p.contexts.B.split('\n')[0]?.slice(0, 60));
  console.log('  C 首条:', p.contexts.C.split('\n')[0]?.slice(0, 60));
}
