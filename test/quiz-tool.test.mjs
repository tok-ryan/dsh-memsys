import test from 'node:test';
import assert from 'node:assert/strict';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
} from '../src/storage/repositories.mjs';
import { createQuizHandler } from '../src/tools/quiz.mjs';
import {
  createTestContext,
  fixedClock,
  makeCandidate,
  makeMemory,
  makeObservation,
} from './helpers/fixtures.mjs';

const RAW = '主人不吃葱，因为从小闻到葱味就难受，点外卖会备注不要葱，也不要香菜。';

/** observation -> candidate -> memory 一条链。 */
function seed(ctx, { text = RAW, why = '主人不吃葱。', seq = 1 } = {}) {
  const observation = makeObservation(ctx, { text, messageSeq: seq });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { text, why, confidence: 0.7 });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate, {});
  insertMemory(ctx.main, memory);
  return memory;
}

function handlerFor(ctx) {
  return createQuizHandler({ main: ctx.main, clock: ctx.clock });
}

const memoryCount = (ctx) => Number(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
const usesCount = (ctx) => Number(ctx.main.prepare('SELECT COUNT(*) AS n FROM uses').get().n);

test('P6/quiz tool: pick returns a question that never contains the original text', (t) => {
  const ctx = createTestContext({ clock: fixedClock('2026-11-03T00:00:00.000Z') });
  t.after(() => ctx.cleanup());
  const memory = seed(ctx);

  const result = handlerFor(ctx).run({ mode: 'pick' });
  assert.equal(result.status, 'ok');
  assert.equal(result.mode, 'pick');
  assert.equal(result.id, memory.id);
  assert.equal(typeof result.prompt, 'string');
  // 原话的任意 12 字窗口都不许出现在题面里。
  for (let index = 0; index + 12 <= RAW.length; index += 1) {
    assert.ok(!result.prompt.includes(RAW.slice(index, index + 12)), `prompt leaked raw at ${index}`);
  }
});

test('P6/quiz tool: submit grades a recall answer, levels up, and records one attempt', (t) => {
  const ctx = createTestContext({ clock: fixedClock('2026-11-03T00:00:00.000Z') });
  t.after(() => ctx.cleanup());
  const memory = seed(ctx);
  const before = { memories: memoryCount(ctx), uses: usesCount(ctx) };

  const handler = handlerFor(ctx);
  assert.equal(handler.run({ mode: 'pick' }).id, memory.id);
  const graded = handler.run({ mode: 'submit', kind: 'pick', id: memory.id, answer: RAW });

  assert.equal(graded.status, 'ok');
  assert.equal(graded.kind, 'pick');
  assert.ok(graded.score >= 0.8, `full recall should score high, got ${graded.score}`);
  assert.equal(graded.state.level, 1, 'score >= 0.8 steps the level up');
  assert.equal(graded.state.next_review_days, 4);

  const state = ctx.main.prepare('SELECT * FROM quiz_state WHERE memory_id = ?').get(memory.id);
  assert.equal(state.attempts, 1);
  assert.equal(state.level, 1);

  const attempts = ctx.main.prepare('SELECT * FROM quiz_attempts WHERE memory_id = ?').all(memory.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].mode, 'pick');

  // 硬边界：考试不碰 memories / uses。
  assert.equal(memoryCount(ctx), before.memories);
  assert.equal(usesCount(ctx), before.uses);
});

test('P6/quiz tool: a bad answer resets the level and is counted as 考砸', (t) => {
  const ctx = createTestContext({ clock: fixedClock('2026-11-03T00:00:00.000Z') });
  t.after(() => ctx.cleanup());
  const memory = seed(ctx);
  const handler = handlerFor(ctx);

  handler.run({ mode: 'submit', kind: 'pick', id: memory.id, answer: RAW });
  const bad = handler.run({ mode: 'submit', kind: 'pick', id: memory.id, answer: '不知道' });

  assert.equal(bad.status, 'ok');
  assert.ok(bad.score < 0.6);
  assert.equal(bad.state.level, 0, 'score < 0.6 drops the level back to 0');

  const status = handler.run({ mode: 'status' });
  assert.equal(status.status, 'ok');
  assert.equal(status.examined, 1);
  assert.equal(status.bad_count, 1);
  assert.equal(status.attempts, 2);
  assert.equal(status.worst.id, memory.id);
});

test('P6/quiz tool: challenge hides the truth in the question and grades the spot', (t) => {
  const ctx = createTestContext({ clock: fixedClock('2026-11-03T00:00:00.000Z') });
  t.after(() => ctx.cleanup());
  const memory = seed(ctx);
  const handler = handlerFor(ctx);

  const question = handler.run({ mode: 'challenge' });
  assert.equal(question.status, 'ok');
  assert.equal(question.mode, 'challenge');
  assert.equal(typeof question.prompt, 'string');
  // 题面贴的是改坏的那段，不是原文。
  assert.ok(!question.prompt.includes(RAW));

  const answer = '数字 43 那里不对，原文不是 43。';
  const graded = handler.run({ mode: 'submit', kind: 'challenge', id: memory.id, answer });
  assert.equal(graded.status, 'ok');
  assert.equal(graded.kind, 'challenge');
  assert.equal(typeof graded.hit, 'boolean');
  assert.equal(graded.state.attempts, 1);
});

test('P6/quiz tool: submit validates its input instead of guessing', (t) => {
  const ctx = createTestContext({ clock: fixedClock('2026-11-03T00:00:00.000Z') });
  t.after(() => ctx.cleanup());
  seed(ctx);
  const handler = handlerFor(ctx);

  assert.deepEqual(
    [handler.run({ mode: 'submit' }).code, handler.run({ mode: 'submit' }).field],
    ['validation_error', 'id'],
  );
  assert.equal(handler.run({ mode: 'submit', id: 'nope', answer: 'x' }).code, 'memory_not_found');
  assert.equal(handler.run({ mode: 'nonsense' }).code, 'validation_error');
});
