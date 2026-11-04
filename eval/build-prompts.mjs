import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { bm25Rank } from '../scripts/eval-memory-data.mjs';

const db = new DatabaseSync('C:/Users/15728/Desktop/ai/memsys-whalesoul-data/memsys.db');
const rows = db.prepare('SELECT id,type,text,why,weight,recorded_at FROM memories').all();
const docs = rows.map((r) => ({ ...r }));

const qs = JSON.parse(fs.readFileSync('eval/questions-codex.json', 'utf8')).questions;
fs.mkdirSync('eval/q', { recursive: true });

const meta = (d) => `- [${d.type} · 权重${d.weight} · ${String(d.recorded_at).slice(0, 10)}]\n  原文：${d.text}\n  为什么记：${d.why || '（无）'}`;
const raw = (d) => `- ${d.text}`;

const index = [];
for (const q of qs) {
  const b = bm25Rank(docs, q.ask, 3);
  const c = bm25Rank(docs, q.ask, 5);
  const variants = {
    A: `你是助手。回答下面这个问题，2~4 句，直接给结论。没有给你任何记忆，凭一般知识回答；不确定就说不确定，不要编。\n\n问题：${q.ask}\n\n只输出答案本身。`,
    B: `你是助手。只依据下面给出的“记忆”回答这个问题，2~4 句，直接给结论；记忆里没有的就说不确定，不要编。\n\n记忆：\n${b.map(raw).join('\n') || '（没有检索到相关记忆）'}\n\n问题：${q.ask}\n\n只输出答案本身。`,
    C: `你是助手。只依据下面给出的“记忆”回答这个问题，2~4 句，直接给结论；记忆里没有的就说不确定，不要编。\n\n记忆：\n${c.map(meta).join('\n') || '（没有检索到相关记忆）'}\n\n问题：${q.ask}\n\n只输出答案本身。`,
  };
  for (const k of ['A', 'B', 'C']) {
    const f = `eval/q/${q.id}-${k}.md`;
    fs.writeFileSync(f, variants[k], 'utf8');
    index.push({ id: q.id, k, file: `C:/Users/15728/Desktop/ai/dsh-memsys-pub/${f}` });
  }
  // 记录召回：gold 记忆有没有进 B/C
  const goldSet = new Set(q.gold_memory_ids || []);
  const hitB = b.filter((d) => goldSet.has(d.id)).length;
  const hitC = c.filter((d) => goldSet.has(d.id)).length;
  q._recall = { gold: goldSet.size, B: hitB, C: hitC };
}
fs.writeFileSync('eval/questions-run.json', JSON.stringify({ questions: qs, index }, null, 2), 'utf8');
console.log('prompts written:', index.length);
let g = 0, hb = 0, hc = 0;
for (const q of qs) { g += q._recall.gold; hb += q._recall.B; hc += q._recall.C; }
console.log(`recall  gold=${g}  B=${hb}  C=${hc}`);
