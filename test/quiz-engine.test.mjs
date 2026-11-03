import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalJson } from '../src/identity.mjs';
import { discoverMigrations } from '../src/storage/migrate.mjs';
import {
  appendRelation,
  insertCandidate,
  insertMemory,
  insertObservation,
} from '../src/storage/repositories.mjs';
import { INTERVALS, dueScore, nextLevel, pickDue } from '../src/quiz/schedule.mjs';
import { listCandidates, toEntry } from '../src/quiz/source.mjs';
import {
  createTestContext,
  fixedClock,
  makeCandidate,
  makeMemory,
  makeObservation,
} from './helpers/fixtures.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-03T00:00:00.000Z');
const isoAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();

const close = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`,
  );

/** Insert one observation -> candidate -> memory chain. */
function seedMemory(ctx, overrides = {}) {
  const text = overrides.text ?? '主人不吃葱，因为从小闻到葱味就难受，点外卖会备注不要葱。';
  const observation = makeObservation(ctx, { text, messageSeq: overrides.messageSeq ?? 1 });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, {
    text,
    why: overrides.why ?? '主人不吃葱。',
    confidence: overrides.confidence ?? 0.7,
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate, { credibility: overrides.credibility ?? 'unverified' });
  insertMemory(ctx.main, memory);
  return { observation, candidate, memory };
}

/** Fold one memory to the terminal `retired` state through the relation ledger. */
function retire(ctx, memoryId) {
  appendRelation(ctx.main, {
    type: 'demote',
    payload: { targetId: memoryId },
    businessKey: `demote:${memoryId}`,
    at: ctx.clock.at().at,
  });
}

function snapshotMemoryTables(db) {
  return {
    memories: db.prepare('SELECT * FROM memories ORDER BY id').all().map((row) => canonicalJson(row)),
    uses: Number(db.prepare('SELECT COUNT(*) AS n FROM uses').get().n),
    relations: db.prepare('SELECT * FROM relations ORDER BY id').all().map((row) => canonicalJson(row)),
  };
}

test('quiz schedule: nextLevel moves in three tiers and caps at 4', () => {
  assert.equal(INTERVALS.length, 5);
  assert.equal(nextLevel(0.9, 1), 2); // >= 0.8 -> step up
  assert.equal(nextLevel(0.8, 0), 1); // boundary is inclusive
  assert.equal(nextLevel(0.79, 3), 3); // middle band holds
  assert.equal(nextLevel(0.6, 2), 2); // 0.6 is still the middle band
  assert.equal(nextLevel(0.59, 4), 0); // below 0.6 -> reset
  assert.equal(nextLevel(1, 4), 4); // capped
  assert.equal(nextLevel(0.85, 4), 4); // capped
  assert.throws(() => nextLevel('0.9', 1), TypeError);
});

test('quiz schedule: dueScore returns 3 / -1 / overdue weight exactly like echo', () => {
  const base = { id: 'm1', weight: 50, pinned: false };
  assert.equal(dueScore(base, null, NOW), 3); // never examined
  assert.equal(dueScore(base, {}, NOW), 3); // state row without lastAt = never examined
  assert.equal(dueScore(base, { level: 0, lastAt: isoAgo(0) }, NOW), -1); // not due
  close(dueScore(base, { level: 0, lastAt: isoAgo(3) }, NOW), (1 + 2) * (0.6 + 0.5), 'level 0, 3 days');
  // level 2 means a 16-day interval, so 7 days is still early.
  assert.equal(dueScore(base, { level: 2, lastAt: isoAgo(7) }, NOW), -1);
  close(dueScore(base, { level: 2, lastAt: isoAgo(20) }, NOW), (1 + 4) * (0.6 + 0.5), 'level 2, 20 days');
  // pinned gets echo's flat 1.6 instead of weight/100.
  close(dueScore({ ...base, pinned: true }, { level: 0, lastAt: isoAgo(3) }, NOW), 3 * 2.2, 'pinned');
  // overdue is capped at 30 days.
  close(dueScore(base, { level: 0, lastAt: isoAgo(40) }, NOW), 31 * (0.6 + 0.5), 'capped');
  // Date and ISO string are both accepted as `now`.
  assert.equal(
    dueScore(base, { level: 0, lastAt: isoAgo(0) }, new Date(NOW)),
    dueScore(base, { level: 0, lastAt: isoAgo(0) }, new Date(NOW).toISOString()),
  );
});

test('quiz schedule: pickDue takes the highest score and returns null when nothing is due', () => {
  const never = { id: 'a', weight: 50, pinned: false };
  const overdue = { id: 'b', weight: 50, pinned: false };
  const early = { id: 'c', weight: 90, pinned: false };
  const stateMap = new Map([
    ['b', { level: 0, lastAt: isoAgo(10) }],
    ['c', { level: 2, lastAt: isoAgo(7) }],
  ]);
  assert.equal(pickDue([never, overdue, early], stateMap, NOW), overdue);
  // Plain-object state maps are accepted as well.
  assert.equal(pickDue([never, overdue, early], Object.fromEntries(stateMap), NOW), overdue);
  // Everyone already examined and not due -> nothing to quiz.
  assert.equal(pickDue([early], stateMap, NOW), null);
  assert.equal(pickDue([], stateMap, NOW), null);
});

test('quiz source: toEntry maps gist to why, keeps title display-only and excludes non-active sources', () => {
  const row = {
    id: 'mem_x',
    text: '主人不吃葱，因为从小闻到葱味就难受，点外卖会备注不要葱。',
    why: '主人不吃葱。',
    initial_strength: 0.5,
  };
  const entry = toEntry(row);
  assert.equal(entry.raw, row.text);
  assert.equal(entry.gist, row.why); // D3: gist is why, never text
  assert.equal(entry.title, Array.from(row.text).slice(0, 16).join(''));
  assert.equal(entry.weight, 50);
  assert.equal(entry.confidence, 0.5);
  assert.equal(entry.pinned, false);
  assert.equal(entry.status, 'active');
  assert.equal(toEntry({ ...row, initial_strength: 0.87 }).weight, 87);

  const ctx = createTestContext({ clock: fixedClock() });
  try {
    const normal = seedMemory(ctx, { messageSeq: 1 });
    const dream = seedMemory(ctx, { messageSeq: 2, credibility: 'from-dream', text: '梦里主人说想去火星看海。' });
    const retired = seedMemory(ctx, { messageSeq: 3, text: '主人住在广州。', why: '主人报过住址。' });
    retire(ctx, retired.memory.id);

    const entries = listCandidates(ctx.main);
    const ids = entries.map((item) => item.id);
    assert.ok(ids.includes(normal.memory.id), 'active memory must be a quiz source');
    assert.ok(!ids.includes(dream.memory.id), 'D4: from-dream memory must not be a quiz source');
    assert.ok(!ids.includes(retired.memory.id), 'retired memory must never be a quiz source');

    const entry0 = entries.find((item) => item.id === normal.memory.id);
    assert.equal(entry0.gist, normal.memory.why);
    assert.equal(entry0.weight, Math.round(normal.memory.initial_strength * 100));
    assert.equal(entry0.confidence, 0.7); // joined from candidates.confidence
    assert.equal(entry0.status, 'active');

    const withDream = listCandidates(ctx.main, { includeDream: true }).map((item) => item.id);
    assert.ok(withDream.includes(dream.memory.id), 'includeDream re-enables dream memories');
    assert.ok(!withDream.includes(retired.memory.id), 'retired stays out even with includeDream');
  } finally {
    ctx.cleanup();
  }
});

test('quiz storage: main-009 tables are writable and memories/uses stay untouched', () => {
  const ctx = createTestContext({ clock: fixedClock() });
  try {
    const expectedVersion = Math.max(...discoverMigrations().main.map((migration) => migration.version));
    const version = Number(ctx.main.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v);
    assert.equal(version, expectedVersion);
    const tables = ctx.main
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'quiz%' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, ['quiz_attempts', 'quiz_state']);

    const { memory } = seedMemory(ctx, { messageSeq: 1 });
    const before = snapshotMemoryTables(ctx.main);
    const at = ctx.clock.at().at;

    // quiz_state starts empty for this memory; then a level-0 row is written and updated.
    assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM quiz_state').get().n, 0);
    ctx.main
      .prepare('INSERT INTO quiz_state (memory_id, level, attempts) VALUES (?, 0, 0)')
      .run(memory.id);
    ctx.main
      .prepare(
        `UPDATE quiz_state
            SET level = ?, attempts = ?, last_at = ?, last_score = ?, best_score = ?
          WHERE memory_id = ?`,
      )
      .run(1, 1, at, 0.85, 0.85, memory.id);
    const state = ctx.main.prepare('SELECT * FROM quiz_state WHERE memory_id = ?').get(memory.id);
    assert.equal(state.level, 1);
    assert.equal(state.attempts, 1);
    assert.equal(state.last_at, at);
    assert.equal(state.last_score, 0.85);
    assert.equal(state.best_score, 0.85);

    // One exam row, JSON columns defaulted.
    ctx.main
      .prepare(
        `INSERT INTO quiz_attempts (id, memory_id, mode, score, cover, sim, answer, hits, missing, invented, at)
         VALUES (?, ?, 'pick', 0.85, 0.8, 0.9, '答', '["2026-10-28"]', '[]', '[]', ?)`,
      )
      .run('att_1', memory.id, at);
    const attempt = ctx.main.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get('att_1');
    assert.equal(attempt.memory_id, memory.id);
    assert.equal(attempt.mode, 'pick');
    assert.equal(attempt.score, 0.85);
    assert.equal(JSON.parse(attempt.hits)[0], '2026-10-28');
    assert.deepEqual(JSON.parse(attempt.missing), []);

    // Constraints: unknown parent, bad mode, bad score.
    assert.throws(
      () => ctx.main.prepare('INSERT INTO quiz_state (memory_id) VALUES (?)').run('mem_missing'),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        ctx.main
          .prepare(
            "INSERT INTO quiz_attempts (id, memory_id, mode, score, answer, at) VALUES ('att_x', ?, 'recite', 0.5, 'x', ?)",
          )
          .run(memory.id, at),
      /CHECK/,
    );

    // Hard boundary: quiz writes must not touch memories, uses or the ledger.
    assert.deepEqual(snapshotMemoryTables(ctx.main), before);
  } finally {
    ctx.cleanup();
  }
});
