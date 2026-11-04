import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { expandTerms, loadAliases, setAliasProvider, synonymGroups, tokenizeQuery } from '../src/read/expand.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { insertCandidate, insertMemory, insertObservation, insertPointer, insertTimeline } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

function seedMemory(ctx, { messageSeq, text, why = 'w', detail = null }) {
  const observation = makeObservation(ctx, { messageSeq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, {
    businessKey: `expand-${messageSeq}`,
    text,
    why,
    detail,
    type: 'fact',
    scene: 'work',
    scope: 'work-only',
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, {
    memory_id: memory.id,
    start_at: null,
    end_at: null,
    prec_start: 'unknown',
    prec_end: 'unknown',
    time_state: 'point',
    revision: 1,
  });
  insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
  return memory;
}

test('expand: 口语问句被切成检索词并扩展出同义词', () => {
  const { terms, added } = expandTerms('我挥霍 token 吗');
  // 短块整块保留（「我挥霍」不拆），英文整词保留
  assert.ok(terms.includes('我挥霍'), JSON.stringify(terms));
  assert.ok(terms.includes('token'));
  // 长句才拆二元组
  assert.deepEqual(tokenizeQuery('我那几条创作线做到哪了'), ['我那', '那几', '几条', '条创', '创作', '作线', '线做', '做到', '到哪', '哪了']);
  for (const expected of ['成本', '花费', '测算']) {
    assert.ok(added.includes(expected), `${expected} missing: ${JSON.stringify(added)}`);
  }
  // 确定性 + 无重复
  assert.deepEqual(expandTerms('我挥霍 token 吗'), expandTerms('我挥霍 token 吗'));
  assert.equal(new Set(added).size, added.length);
});

test('expand: 无关句不产出扩展词（不过度放宽）', () => {
  assert.deepEqual(expandTerms('今天天气怎么样'), { terms: tokenizeQuery('今天天气怎么样'), added: [] });
});

test('expand: 没有命中任何 trigger 时不改动入参、空输入安全', () => {
  const input = ['完全不存在的话题'];
  const before = [...input];
  const result = expandTerms(input);
  assert.deepEqual(input, before);
  assert.deepEqual(expandTerms(''), { terms: [], added: [] });
  assert.deepEqual(expandTerms(null), { terms: [], added: [] });
  assert.deepEqual(expandTerms(undefined), { terms: [], added: [] });
});

test('expand: 扩展词总数封顶 MAX_EXTRA=12', () => {
  const { added } = expandTerms('钱 时间 视频 网页 工作 人格 对象 八字 沟通 调研');
  assert.ok(added.length <= 12, `too many: ${added.length}`);
});

test('expand: 私人别名由 provider 注入，不可用时静默退回通用词', (t) => {
  t.after(() => setAliasProvider(null));
  setAliasProvider(() => [
    { triggers: ['创作线'], adds: ['测试作品甲', '测试作品乙'] },
    { triggers: [], adds: ['坏组'] },
    'not-a-group',
  ]);
  const { added } = expandTerms('那几条创作线做到哪了');
  assert.ok(added.includes('测试作品甲'), JSON.stringify(added));
  assert.ok(added.includes('测试作品乙'));
  assert.ok(!added.includes('坏组'));
  setAliasProvider(() => {
    throw new Error('别名源坏了');
  });
  const fallback = expandTerms('那几条创作线做到哪了');
  assert.ok(!fallback.added.includes('测试作品甲'));
});

test('expand: loadAliases 对缺失/坏文件/正常文件都安全', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-alias-'));
  try {
    assert.deepEqual(loadAliases(dir), []);
    fs.writeFileSync(path.join(dir, 'aliases.json'), '{ not json', 'utf8');
    assert.deepEqual(loadAliases(dir), []);
    fs.writeFileSync(
      path.join(dir, 'aliases.json'),
      JSON.stringify([{ triggers: ['创作线'], adds: ['测试作品甲'] }, { triggers: ['x'], adds: [] }]),
      'utf8',
    );
    const groups = loadAliases(dir);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].adds, ['测试作品甲']);
    assert.deepEqual(loadAliases(''), []);
    assert.deepEqual(loadAliases(null), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('search: 只写在 why 里的线索也能被扩展词捞到', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const memory = seedMemory(ctx, { messageSeq: 18001, text: '他在钱上很小心', why: '成本敏感，先测算再动手' });

  const result = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: '他会不会挥霍', maxChars: 8000 });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.ok(result.hits.some((hit) => hit.id === memory.id), JSON.stringify(result.hits));
  assert.ok(result.hits.every((hit) => typeof hit.text === 'string' && !hit.text.includes('成本敏感')));
});

test('search: 多关键词（数组）排序仍按原问字面相关度，不退化成纯新鲜度', (t) => {
  const mutable = mutableClock();
  const ctx = createTestContext({ clock: mutable.clock });
  t.after(() => ctx.cleanup());
  const older = seedMemory(ctx, { messageSeq: 19001, text: '网页配色用米白打底' });
  mutable.advance(60_000);
  const newer = seedMemory(ctx, { messageSeq: 19002, text: '网页打开有点慢' });
  assert.notEqual(older.id, newer.id);
  // newer 的 recorded_at 更晚；若排序退化成纯新鲜度会排第一
  const result = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: ['网页配色'], maxChars: 8000 });
  const ids = result.hits.map((hit) => hit.id);
  assert.ok(ids.includes(older.id), JSON.stringify(ids));
  assert.equal(ids[0], older.id, `expected older first, got ${JSON.stringify(ids)}`);
});

test('search: 完全不存在的关键词仍然零命中（防放宽成什么都收）', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  seedMemory(ctx, { messageSeq: 20001, text: '周末打球' });
  const result = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: ['完全不存在'], maxChars: 8000 });
  assert.equal(result.direct_hit_count, 0, JSON.stringify(result.hits));
});

test('expand: synonymGroups 是只读副本，不含私人别名', () => {
  const groups = synonymGroups();
  assert.ok(groups.length > 0);
  groups[0].triggers.push('被改动');
  assert.ok(!synonymGroups()[0].triggers.includes('被改动'));
});
