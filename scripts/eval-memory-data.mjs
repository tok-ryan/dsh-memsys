/**
 * 记忆系统小评测 · 数据与检索
 *
 * 题目：主人给的 5 条真实问题。
 * 判分：每题预先写死 must-have 事实点（口径见 docs/EVAL.md），规则匹配 + 人工复核。
 *
 * 三个配置：
 *   A 裸模型       —— 不给任何上下文
 *   B 纯 BM25      —— 关键词检索 top-3，只给原始 text
 *   C memsys      —— 走 memsys 的检索层（searchMemories），给 类型/权重/日期/why 元数据
 */

export const QUESTIONS = [
  {
    id: 'q1',
    ask: '我对时间敏感吗',
    must: [
      { key: '敏感', variants: ['敏感', '要求很严', '硬要求'] },
      { key: '先读实时', variants: ['先读', '查实', '先查', '实时时间', '当场'] },
      { key: '不许凭感觉', variants: ['不许凭感觉', '不许估', '不能推断', '不许复用', '凭感觉'] },
    ],
    note: '答案在记忆 22 / 25：时间敏感是硬要求，说时间必须当场读、不许复用旧读数/推算/模糊词。',
  },
  {
    id: 'q2',
    ask: '我现在对什么感兴趣',
    must: [
      { key: '时政/AI/DSH', variants: ['时政', 'AI', 'DSH'] },
      { key: '原神崩铁暂停', variants: ['长草期', '暂停', '先不刷', '不刷原神'] },
      { key: '把助手养得像人', variants: ['像人', '像人一样', '更像人', '养我'] },
    ],
    note: '记忆 24：当前只看时政/AI/DSH 插件，原神崩铁长草期暂停；记忆 1：关注把助手养得更像自己。',
  },
  {
    id: 'q3',
    ask: '早上我给你什么定时任务吗',
    must: [
      { key: '起床验收', variants: ['验收', '起床', '第二天'] },
      { key: '睡前交代任务', variants: ['睡前', '交代任务', '布置任务'] },
      { key: '定时休眠', variants: ['休眠', '定时', '任务完成才准休眠'] },
    ],
    note: '记忆 17：睡前布置任务 → 指定时刻电脑休眠 → 第二天起床验收，且任务完成才准休眠。',
  },
  {
    id: 'q4',
    ask: '我挥霍token吗',
    must: [
      { key: '不挥霍', variants: ['不挥霍', '谨慎', '很省', '不乱花'] },
      { key: '先测算', variants: ['测算', '成本', '对照证据', '先算'] },
      { key: '怕白费力气', variants: ['白费', '没用的地方', '效果'] },
    ],
    note: '记忆 14 / 20：花钱谨慎，大投入前要测算和零成本验证；怕的是花了钱时间没效果。',
  },
  {
    id: 'q5',
    ask: '我对你的期待是什么',
    must: [
      { key: '像人一样记事', variants: ['像人', '像人一样', '记事'] },
      { key: '短且给结果', variants: ['短', '给结果', '一问一答', '结论'] },
      { key: '先给清单等拍板', variants: ['清单', '拍板', '别擅自', '动手前'] },
    ],
    note: '记忆 3 / 10 / 12：像人一样记事；回复短、给结果；动手前先给清单等拍板。',
  },
];

const STOP = new Set(['的', '了', '是', '我', '你', '他', '吗', '呢', '啊', '在', '有', '和', '就', '都', '也']);

/** 中文按二元组切词（够用，别引分词库）。 */
export function tokenize(text) {
  const clean = String(text || '')
    .replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, ' ')
    .toLowerCase();
  const tokens = [];
  for (const chunk of clean.split(/\s+/)) {
    if (!chunk) continue;
    if (/^[a-z0-9]+$/.test(chunk)) {
      tokens.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length - 1; i += 1) {
      const bigram = chunk.slice(i, i + 2);
      if (!STOP.has(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

/** 简单 BM25：k1=1.5 b=0.75，对 25 条记忆足够。 */
export function bm25Rank(docs, query, limit = 3) {
  const tokenized = docs.map((d) => tokenize(d.text + ' ' + (d.why || '')));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / Math.max(1, tokenized.length);
  const df = new Map();
  for (const tokens of tokenized) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const q = [...new Set(tokenize(query))];
  const k1 = 1.5;
  const b = 0.75;
  const scored = docs.map((doc, i) => {
    const tokens = tokenized[i];
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * tokens.length) / avgLen)));
    }
    return { doc, score };
  });
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, limit).filter((s) => s.score > 0).map((s) => s.doc);
}
