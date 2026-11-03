import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TAMPER_KINDS, tamper } from '../src/quiz/tamper.mjs';
import {
  bigrams, coverage, gradePick, hardBits, jaccard, judgeChallenge, normalize,
} from '../src/quiz/grade.mjs';
import { buildChallengePrompt, buildPickPrompt } from '../src/quiz/prompt.mjs';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'quiz');

/** 前缀/后缀对齐后的唯一差异块；单点替换时 before/after 就是替换前后的片段。 */
function diffHunk(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { before: before.slice(start, endBefore), after: after.slice(start, endAfter) };
}

/** 题面里有没有 raw 的 >= 12 字连续片段。 */
function leaksRawWindow(prompt, raw) {
  const text = normalize(prompt);
  const reference = normalize(raw);
  if (!text || !reference) return false;
  const size = Math.min(12, reference.length);
  for (let index = 0; index + size <= reference.length; index += 1) {
    if (text.includes(reference.slice(index, index + size))) return true;
  }
  return false;
}

test('tamper: 四类改写各一例，单点替换、答案唯一', () => {
  const cases = [
    { input: '2026-10-28 我把录音整理完了', kind: 'date', truth: '2026-10-28', expected: '2026-10-01' },
    { input: '花了 43分钟 才把录音弄完', kind: 'number', truth: '43分钟', expected: '22分钟' },
    { input: '他说不用看了', kind: 'flip', truth: '不用', expected: '要看了' },
    { input: '主人让我今天早点睡', kind: 'subject', truth: '主人', expected: '我让我今天早点睡' },
  ];
  assert.deepEqual(TAMPER_KINDS, ['date', 'number', 'flip', 'subject']);

  for (const item of cases) {
    const result = tamper(item.input);
    assert.ok(result, `${item.kind} 应能出题`);
    assert.equal(result.kind, item.kind);
    assert.equal(result.text, item.input, 'text 必须是原文');
    assert.equal(result.truth, item.truth);
    assert.ok(result.fake.includes(item.expected), `${result.fake} 应含 ${item.expected}`);
    assert.notEqual(result.fake, item.input);
    assert.equal(typeof result.note, 'string');

    const hunk = diffHunk(item.input, result.fake);
    assert.ok(hunk.before.length > 0 && hunk.after.length > 0, `${item.kind} 必须恰好一个替换点`);
    assert.ok(item.truth.includes(hunk.before) || hunk.before === item.truth, `${item.kind} 的改动应落在 truth 内`);
    assert.equal(item.input.replace(hunk.before, hunk.after), result.fake, `${item.kind} 只能改一处`);
  }
});

test('tamper: 顺序、边界与确定性', () => {
  const dateFirst = tamper('2026-10-28 花了 43分钟');
  assert.equal(dateFirst.kind, 'date', '日期优先于数字');
  assert.equal(dateFirst.truth, '2026-10-28');
  assert.equal(dateFirst.fake, '2026-10-01 花了 43分钟');

  const cnDate = tamper('10月28日 交的录音');
  assert.equal(cnDate.kind, 'date');
  assert.equal(cnDate.truth, '10月28日');
  assert.equal(cnDate.fake, '10月1日 交的录音');

  assert.equal(tamper('2026-10-01 交卷').fake, '2026-10-02 交卷', '日=1 时改成 2');
  assert.equal(tamper('等了 1天').fake, '等了 2天', 'n=1 → 2');
  assert.equal(tamper('用了 2天').fake, '用了 1天', 'n=2 → 1');
  assert.equal(tamper('花了 3小时').fake, '花了 2小时');

  assert.equal(tamper('今天天气不错'), null, '没有可改的点');
  assert.equal(tamper(''), null);
  assert.equal(tamper(null), null);
  assert.deepEqual(tamper('他说不用看了'), tamper('他说不用看了'), '同一输入同一输出');
});

test('grade: normalize / bigrams / sim / cover / hardBits 口径', () => {
  assert.equal(normalize('Hello，世界！'), 'hello世界');
  assert.deepEqual([...bigrams('主人')], ['主人']);
  assert.deepEqual([...bigrams('主')], ['主']);
  assert.deepEqual([...bigrams('')], []);

  assert.equal(jaccard('主人喜欢喝茶', '主人喜欢喝茶'), 1);
  assert.equal(jaccard('主人喜欢喝茶', '今天下雨了'), 0);
  assert.equal(jaccard('', '任何内容'), 0);
  assert.equal(jaccard('任何内容', ''), 0);

  assert.equal(coverage('主人喜欢喝茶', '主人喜欢喝茶'), 1);
  assert.equal(coverage('主人喜欢喝茶', ''), 0);
  assert.equal(coverage('', '答了'), 1, 'echo 原语义：ref 空时 cover=1');

  const bits = hardBits('2026-10-28 花了 43分钟 看《考试脑科学》，"重点"标出，DSH 插件');
  for (const expected of ['2026-10-28', '43分钟', '考试脑科学', '重点', 'DSH']) {
    assert.ok(bits.includes(expected), `hardBits 应含 ${expected}`);
  }
  assert.deepEqual(hardBits('主人不喜欢，我不同意'), [], 'hardBits 不含否定词/主体（D5）');
});

test('gradePick: 照抄满分 / 空答案 0 / 缺硬料与臆造', () => {
  const ref = '主人要求 2026-10-28 之前把《考试脑科学》看完，每天 43分钟';
  const full = gradePick(ref, ref);
  assert.equal(full.score, 1);
  assert.equal(full.cover, 1);
  assert.equal(full.sim, 1);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.invented, []);
  assert.deepEqual(full.hits.sort(), hardBits(ref).sort());

  const blank = gradePick(ref, '   ');
  assert.equal(blank.score, 0);
  assert.equal(blank.cover, 0);
  assert.equal(blank.sim, 0);

  const partial = gradePick('2026-10-28 之前看完《考试脑科学》', '2026-11-01 之前看完《考试脑科学》');
  assert.ok(partial.missing.includes('2026-10-28'), '改错日期应进 missing');
  assert.ok(partial.invented.includes('2026-11-01'), '答里多出的日期应进 invented');
  assert.ok(partial.hits.includes('考试脑科学'));
  assert.ok(partial.score > 0 && partial.score < 1);
  assert.equal(partial.score, Math.max(0, Math.min(1, partial.cover * 0.7 + partial.sim * 0.3)));

  assert.equal(gradePick('', '随便答').score, 0, 'ref 空不给白送分');
  assert.equal(gradePick(null, null).score, 0);
});

test('judgeChallenge: 三信号 0/1/2 三档 + 四类指向词', () => {
  const dateTampered = tamper('2026-10-28 我把录音整理完了');

  const none = judgeChallenge('我记不清了', dateTampered);
  assert.equal(none.hit, false);
  assert.equal(none.signals.length, 0);

  const one = judgeChallenge('是日期的问题吧', dateTampered);
  assert.equal(one.signals.length, 1, '只有指向词，不够');
  assert.equal(one.hit, false);

  const two = judgeChallenge('日期错了吧', dateTampered);
  assert.equal(two.signals.length, 2);
  assert.equal(two.hit, true);
  assert.equal(two.ok, true);

  assert.equal(judgeChallenge('', dateTampered).hit, false);

  assert.equal(judgeChallenge('数字不对', tamper('花了 43分钟 才弄完')).hit, true);
  assert.equal(judgeChallenge('意思反了，不对', tamper('他说不用看了')).hit, true);
  assert.equal(judgeChallenge('是主人不是他', tamper('主人让我早点睡')).hit, true);
});

test('prompt: pick 只给元信息 + 我的理解，不含 title 与 raw', () => {
  const entry = {
    id: 'm-1',
    title: '主人让我把 43分钟 的录音整',
    raw: '主人让我把 43分钟 的录音整理成文字，并标出重点，周五之前交给他。',
    gist: '他催得急，我先整理再说',
    type: 'promise',
    scene: 'work',
    tags: ['录音', '整理'],
    createdAt: '2026-10-28T09:00:00+08:00',
  };
  const frozen = JSON.parse(JSON.stringify(entry));
  const prompt = buildPickPrompt(entry);

  assert.equal(prompt.includes(entry.gist), true, '必须给「我的理解」');
  assert.equal(prompt.includes(entry.title), false, 'title 不进题面（D3）');
  assert.equal(prompt.includes(entry.raw), false, 'raw 原话绝不出现');
  assert.equal(leaksRawWindow(prompt, entry.raw), false, '不得出现 raw 的 12 字连续片段');
  assert.equal(prompt.includes('类型：promise'), true);
  assert.equal(prompt.includes('场景：work'), true);
  assert.equal(prompt.includes('标签：录音 整理'), true);
  assert.equal(prompt.includes('2026-10-28T09:00:00+08:00'), true);
  assert.deepEqual(entry, frozen, '不得改动入参');
});

test('prompt: gist 与 raw 重合 >= 12 字 -> 换占位，仍不泄 raw', () => {
  const raw = '主人让我把 43分钟 的录音整理成文字并标出重点';
  const entry = { raw, gist: raw, title: raw.slice(0, 16), tags: ['录音', raw.slice(0, 14)] };
  const prompt = buildPickPrompt(entry);

  assert.equal(prompt.includes(raw), false);
  assert.equal(prompt.includes(raw.slice(0, 12)), false);
  assert.equal(leaksRawWindow(prompt, raw), false);
  assert.equal(prompt.includes('已隐去'), true);
  assert.equal(prompt.includes('录音'), true, '短标签不算泄漏');
  assert.equal(prompt.includes(raw.slice(0, 14)), false, '长标签也要滤掉');
});

test('prompt: challenge 只给改坏版本，空 tampered 抛错', () => {
  const tampered = tamper('2026-10-28 我把录音整理完了');
  const prompt = buildChallengePrompt({ id: 'm-1', title: '不该出现的标题' }, tampered);

  assert.equal(prompt.includes(tampered.fake), true);
  assert.equal(prompt.includes(tampered.truth), false, '不能把正确写法直接写进题面');
  assert.equal(prompt.includes('指出'), true);
  assert.equal(prompt.includes('不该出现的标题'), false);

  assert.throws(() => buildChallengePrompt({}, null), TypeError);
  assert.throws(() => buildChallengePrompt({}, { fake: '   ' }), TypeError);
});

test('三个模块零副作用：无 fs / sqlite / 时间 / 随机数', () => {
  const forbidden = [
    /from ['"]node:(fs|sqlite|child_process|os)['"]/,
    /Date\.now\s*\(/,
    /new Date\s*\(/,
    /Math\.random\s*\(/,
    /writeFile/,
  ];
  for (const file of ['tamper.mjs', 'grade.mjs', 'prompt.mjs']) {
    const source = fs.readFileSync(path.join(MODULE_DIR, file), 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${file} 不应出现 ${pattern}`);
    }
  }
});
