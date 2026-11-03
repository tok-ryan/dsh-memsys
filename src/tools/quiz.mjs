/**
 * `memsys_quiz` — 复习考试（0.3.0）。
 *
 * 四种模式：
 *   pick      出一道理复述题（只给元信息 + 「我的理解」，绝不给原话）
 *   challenge 出一道辨伪题（把一条真记忆改坏一处）
 *   submit    交卷判分，写 quiz_state / quiz_attempts
 *   status    报「考过 N 条 / 平均分 / 考砸几条 / 最差一条」
 *
 * 边界（echo 时代留下的硬规矩，不能破）：考试只写 quiz_state / quiz_attempts，
 * `memories` 行数、`uses` 表、任何 verdict 字段都不动。
 *
 * `challenge` 的判卷不需要回传题面：`tamper()` 是纯函数（无随机、无时间），
 * 同一段原文永远改出同一处，所以 submit 时重新算一遍即可。
 */

import { judgeChallenge, gradePick } from '../quiz/grade.mjs';
import { buildChallengePrompt, buildPickPrompt } from '../quiz/prompt.mjs';
import { nextLevel, pickDue } from '../quiz/schedule.mjs';
import { listCandidates } from '../quiz/source.mjs';
import { tamper } from '../quiz/tamper.mjs';
import { INTERVALS } from '../quiz/schedule.mjs';

/** 辨伪题至少要这么长才改得出有意义的一处（echo 用 25）。 */
const CHALLENGE_MIN_CHARS = 25;

/** 一条记忆考砸的线：分数低于它算「考砸」。 */
const BAD_SCORE = 0.6;

const nowOf = (clock) => {
  try {
    return clock.at().at;
  } catch {
    return new Date().toISOString();
  }
};

function readStates(main) {
  const rows = main
    .prepare('SELECT memory_id, level, attempts, last_at, last_score, best_score FROM quiz_state')
    .all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.memory_id, {
      level: Number(row.level ?? 0),
      attempts: Number(row.attempts ?? 0),
      lastAt: row.last_at ?? null,
      lastScore: row.last_score === null || row.last_score === undefined ? null : Number(row.last_score),
      bestScore: row.best_score === null || row.best_score === undefined ? null : Number(row.best_score),
    });
  }
  return map;
}

function writeAttempt(main, clock, attempt) {
  const at = nowOf(clock);
  const previous = main
    .prepare('SELECT level, attempts, best_score FROM quiz_state WHERE memory_id = ?')
    .get(attempt.memoryId);
  const level = nextLevel(attempt.score, previous?.level ?? 0);
  const attempts = Number(previous?.attempts ?? 0) + 1;
  const best = Math.max(Number(previous?.best_score ?? 0), attempt.score);

  main
    .prepare(
      `INSERT INTO quiz_state (memory_id, level, attempts, last_at, last_score, best_score)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET
         level = excluded.level,
         attempts = excluded.attempts,
         last_at = excluded.last_at,
         last_score = excluded.last_score,
         best_score = excluded.best_score`,
    )
    .run(attempt.memoryId, level, attempts, at, attempt.score, best);

  const id = `quiz-${attempt.memoryId}-${at}-${attempts}`;
  main
    .prepare(
      `INSERT INTO quiz_attempts
         (id, memory_id, mode, score, cover, sim, answer, hits, missing, invented, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      attempt.memoryId,
      attempt.mode,
      attempt.score,
      attempt.cover ?? null,
      attempt.sim ?? null,
      String(attempt.answer ?? '').slice(0, 2000),
      JSON.stringify(attempt.hits ?? []),
      JSON.stringify(attempt.missing ?? []),
      JSON.stringify(attempt.invented ?? []),
      at,
    );

  return {
    level,
    attempts,
    best_score: best,
    next_review_days: INTERVALS[level],
    at,
  };
}

function findEntry(candidates, id) {
  return candidates.find((entry) => entry.id === id) ?? null;
}

/** 选一条能改坏的记忆出辨伪题：优先今天到期的，其次任意够长的。 */
function pickChallengeEntry(candidates, states, now) {
  const tamperable = candidates.filter(
    (entry) => String(entry.raw ?? '').length > CHALLENGE_MIN_CHARS && tamper(entry.raw) !== null,
  );
  if (tamperable.length === 0) return null;
  const due = pickDue(tamperable, states, now);
  return due ?? tamperable[0];
}

export function createQuizHandler({ main, clock }) {
  const run = (args = {}) => {
    const mode = String(args.mode ?? 'pick');
    const now = nowOf(clock);
    let candidates;
    try {
      candidates = listCandidates(main);
    } catch (err) {
      return { status: 'error', code: 'quiz_source_unavailable', message: err.message, clock: now };
    }
    const states = readStates(main);

    if (mode === 'pick') {
      const entry = pickDue(candidates, states, now);
      if (!entry) {
        return {
          status: 'ok',
          mode: 'pick',
          empty: true,
          message: '今天没有到期的记忆。等间隔走完再来，或者去记点新东西。',
          clock: now,
        };
      }
      return {
        status: 'ok',
        mode: 'pick',
        id: entry.id,
        prompt: buildPickPrompt(entry),
        instruction: '凭印象复述，别翻原话。答完用 mode=submit、kind=pick、带上 id 和 answer 交卷。',
        clock: now,
      };
    }

    if (mode === 'challenge') {
      const entry = pickChallengeEntry(candidates, states, now);
      if (!entry) {
        return {
          status: 'ok',
          mode: 'challenge',
          empty: true,
          message: '没有够长、能改坏的记忆可以出辨伪题。',
          clock: now,
        };
      }
      const tampered = tamper(entry.raw);
      return {
        status: 'ok',
        mode: 'challenge',
        id: entry.id,
        prompt: buildChallengePrompt(entry, tampered),
        instruction: '指出这段话里哪儿不对。答完用 mode=submit、kind=challenge、带上 id 和 answer 交卷。',
        clock: now,
      };
    }

    if (mode === 'submit') {
      const id = typeof args.id === 'string' ? args.id : null;
      const answer = typeof args.answer === 'string' ? args.answer : null;
      if (!id || answer === null) {
        return { status: 'error', code: 'validation_error', field: id ? 'answer' : 'id', clock: now };
      }
      const kind = args.kind === 'challenge' ? 'challenge' : 'pick';
      const entry = findEntry(candidates, id);
      if (!entry) {
        return { status: 'error', code: 'memory_not_found', id, clock: now };
      }

      if (kind === 'challenge') {
        const tampered = tamper(entry.raw);
        if (!tampered) {
          return { status: 'error', code: 'not_tamperable', id, clock: now };
        }
        const judged = judgeChallenge(answer, tampered);
        const state = writeAttempt(main, clock, {
          memoryId: id,
          mode: 'challenge',
          score: judged.hit ? 1 : 0,
          answer,
          hits: judged.signals,
          missing: judged.hit ? [] : [tampered.truth],
        });
        return {
          status: 'ok',
          mode: 'submit',
          kind: 'challenge',
          id,
          score: judged.hit ? 1 : 0,
          hit: judged.hit,
          signals: judged.signals,
          truth: tampered.truth,
          fake_spot: tampered.kind,
          state,
          clock: now,
        };
      }

      const graded = gradePick(entry.raw, answer);
      const state = writeAttempt(main, clock, {
        memoryId: id,
        mode: 'pick',
        score: graded.score,
        cover: graded.cover,
        sim: graded.sim,
        answer,
        hits: graded.hits,
        missing: graded.missing,
        invented: graded.invented,
      });
      return {
        status: 'ok',
        mode: 'submit',
        kind: 'pick',
        id,
        score: graded.score,
        cover: graded.cover,
        sim: graded.sim,
        hits: graded.hits,
        missing: graded.missing,
        invented: graded.invented,
        state,
        clock: now,
      };
    }

    if (mode === 'status') {
      const rows = [...states.entries()].map(([memoryId, state]) => ({ memoryId, ...state }));
      const examined = rows.filter((row) => row.attempts > 0);
      const totalAttempts = rows.reduce((sum, row) => sum + row.attempts, 0);
      const scores = rows.filter((row) => typeof row.lastScore === 'number');
      const average =
        scores.length === 0 ? null : scores.reduce((sum, row) => sum + row.lastScore, 0) / scores.length;
      const bad = scores.filter((row) => row.lastScore < BAD_SCORE);
      const worst = scores.length === 0
        ? null
        : scores.reduce((low, row) => (row.lastScore < low.lastScore ? row : low));
      const titleOf = (memoryId) => {
        const entry = findEntry(candidates, memoryId);
        return entry ? entry.title : memoryId;
      };
      return {
        status: 'ok',
        mode: 'status',
        total_memories: candidates.length,
        examined: examined.length,
        attempts: totalAttempts,
        average_score: average === null ? null : Number(average.toFixed(3)),
        bad_count: bad.length,
        mastered: rows.filter((row) => row.level >= INTERVALS.length - 1).length,
        worst: worst === null ? null : { id: worst.memoryId, title: titleOf(worst.memoryId), score: worst.lastScore },
        due_today: candidates.filter((entry) => {
          const state = states.get(entry.id) ?? null;
          return state === null || state.lastAt === null;
        }).length,
        clock: now,
      };
    }

    return { status: 'error', code: 'validation_error', field: 'mode', mode, clock: now };
  };

  return { run };
}
