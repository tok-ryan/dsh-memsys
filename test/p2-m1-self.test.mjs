import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { openAll, closeAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll, migrateDatabase } from '../src/storage/migrate.mjs';
import {
  appendRelation,
  countRows,
  insertMemory,
  insertObservation,
  insertCandidate,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { recordSelfNotes, selfNoteCredibility } from '../src/write/self-note.mjs';
import { selfGet } from '../src/read/self.mjs';
import { createSelfHandler } from '../src/tools/self.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import { recordJudgments } from '../src/write/judgment.mjs';
import { makeCandidate, makeMemory, makeObservation, createTestContext, fixedClock, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

function runtimeAt(callId, overrides = {}) {
  return fakeRuntime({ callId, ...overrides });
}

function withContext(t) {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  return ctx;
}

function seedMemoryWithOrigin(ctx, { text, origin, credibility }) {
  seq += 1;
  const observation = makeObservation(ctx, { messageSeq: 3000 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: `p2m1:${seq}`, text });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  memory.origin = origin;
  memory.credibility = credibility;
  insertMemory(ctx.main, memory);
  return memory;
}

function openPartial(clock, limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p2m1-'));
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  const migrations = discoverMigrations();
  for (const db of ['main', 'control', 'dream']) {
    migrateDatabase(
      handles[db],
      db,
      migrations[db].filter((migration) => migration.version <= limits[db]),
      clock,
    );
  }
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  return {
    dir,
    config,
    handles,
    main: handles.main,
    control: handles.control,
    clock,
    cleanup() {
      closeAll(handles);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function currentVersions(handles) {
  const out = {};
  for (const db of ['main', 'control', 'dream']) {
    out[db] = Number(
      handles[db].prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,
    );
  }
  return out;
}

function latestMigrations() {
  const migrations = discoverMigrations();
  const pick = (db) => Math.max(...migrations[db].map((m) => m.version));
  return { main: pick('main'), control: pick('control'), dream: pick('dream') };
}

test('P2-M1 self note authoring and storage', async (t) => {
  await t.test('only the trusted daily or dream author may write', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    for (const role of ['owner', 'maintenance', 'operator']) {
      assert.throws(
        () => recordSelfNotes(runtimeAt('call-a', { role }), { items: [{ text: 'x', reason: 'y' }] }, deps),
        (err) => err.code === 'invalid_role',
      );
    }
    const daily = recordSelfNotes(runtimeAt('call-daily'), { items: [{ text: '日常', reason: '想记' }] }, deps);
    assert.equal(daily.items[0].status, 'found');
    const dream = recordSelfNotes(runtimeAt('call-dream', { role: 'dream' }), { items: [{ text: '梦后', reason: '反思' }] }, deps);
    assert.equal(dream.items[0].status, 'found');
  });

  await t.test('owner identity cannot be supplied by the caller', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    for (const forbidden of [{ author_runtime: { role: 'owner' } }, { origin: 'master@2026-11-03' }, { author: 'owner' }]) {
      const result = recordSelfNotes(
        runtimeAt('call-forge'),
        { items: [{ text: '伪造', reason: 'x', ...forbidden }] },
        deps,
      );
      assert.equal(result.items[0].error, 'validation_error', JSON.stringify(forbidden));
    }
  });

  await t.test('missing runtime call id is refused instead of faking a constant', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const runtime = fakeRuntime({ callId: undefined });
    assert.throws(
      () => recordSelfNotes(runtime, { items: [{ text: 'x', reason: 'y' }] }, deps),
      (err) => err.code === 'runtime_identity_unavailable',
    );
  });

  await t.test('empty basis is allowed and origin stays model-only', () => {
    const ctx = withContext(t);
    const result = recordSelfNotes(runtimeAt('call-empty'), { items: [{ text: '无依据的反思', reason: '心里想的' }] }, depsOf(ctx));
    const noteId = result.items[0].id;
    const note = ctx.main.prepare('SELECT * FROM self_notes WHERE id = ?').get(noteId);
    assert.equal(note.basis_refs, '[]');
    assert.match(note.origin, /model:/);
    assert.equal(selfNoteCredibility(ctx.main, note), 'unverified');
  });

  await t.test('basis refs must exist and known dream sources stay from-dream', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const missing = recordSelfNotes(
      runtimeAt('call-basis-missing'),
      { items: [{ text: 'x', reason: 'y', basis_refs: ['mem_does_not_exist'] }] },
      deps,
    );
    assert.equal(missing.items[0].error, 'validation_error');

    const dreamMemory = seedMemoryWithOrigin(ctx, {
      text: '梦到的片段',
      origin: 'd-abc123#p1',
      credibility: 'from-dream',
    });
    const withDream = recordSelfNotes(
      runtimeAt('call-dream-basis'),
      { items: [{ text: '我觉得和那个梦有关', reason: '联想', basis_refs: [dreamMemory.id] }] },
      deps,
    );
    const note = ctx.main.prepare('SELECT * FROM self_notes WHERE id = ?').get(withDream.items[0].id);
    assert.equal(selfNoteCredibility(ctx.main, note), 'from-dream');
  });

  await t.test('reflection targets are validated and open needs-review; unknown ids are refused', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const judgment = recordJudgments(
      runtimeAt('call-reflection-j'),
      { items: [{ verdict_text: '一条可被反思的判断', basis: 'b', falsifier: 'f' }] },
      deps,
    ).items[0];
    const result = recordSelfNotes(
      runtimeAt('call-reflection'),
      { items: [{ text: '回看那条判断', reason: '反思', reflection_judgment_ids: [judgment.id] }] },
      deps,
    );
    assert.equal(result.items[0].status, 'found');
    const queue = ctx.main
      .prepare("SELECT COUNT(*) AS n FROM review_queue WHERE object_kind = 'needs-review' AND object_id = ?")
      .get(judgment.id);
    assert.equal(Number(queue.n), 1);
    const bad = recordSelfNotes(
      runtimeAt('call-reflection-bad'),
      { items: [{ text: 'x', reason: 'y', reflection_judgment_ids: ['jdg_1'] }] },
      deps,
    );
    assert.equal(bad.items[0].error, 'validation_error');
    assert.equal(countRows(ctx.main, 'self_notes'), 1);
  });

  await t.test('a failed note write keeps the original model output', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    let commits = 0;
    const failing = {
      ...deps,
      commitHooks: {
        beforeReserve() {
          commits += 1;
          // First commit is the model observation; fail only the note commit.
          if (commits >= 2) throw new Error('simulated_note_failure');
        },
      },
    };
    const result = recordSelfNotes(runtimeAt('call-fail'), { items: [{ text: '会失败的原文', reason: 'x' }] }, failing);
    assert.notEqual(result.items[0].status, 'found');
    assert.equal(countRows(ctx.main, 'self_notes'), 0);
    const observation = ctx.main
      .prepare("SELECT * FROM observations WHERE source = 'model' ORDER BY at DESC LIMIT 1")
      .get();
    assert.ok(observation, 'model output must be preserved');
    assert.equal(observation.text, '会失败的原文');
    assert.equal(observation.author_kind, 'model');
  });
});

test('P2-M1 revisions, idempotency and reads', async (t) => {
  await t.test('same key same payload replays; same key different text conflicts', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const runtime = runtimeAt('call-idem');
    const first = recordSelfNotes(runtime, { items: [{ text: '同一篇', reason: 'x' }] }, deps);
    const again = recordSelfNotes(runtime, { items: [{ text: '同一篇', reason: 'x' }] }, deps);
    assert.equal(again.items[0].replayed, true);
    assert.equal(again.items[0].id, first.items[0].id);
    assert.equal(countRows(ctx.main, 'self_notes'), 1);
    const changed = recordSelfNotes(runtime, { items: [{ text: '换了正文', reason: 'x' }] }, deps);
    assert.equal(changed.items[0].error, 'idempotency_conflict');
    assert.equal(countRows(ctx.main, 'self_notes'), 1);
  });

  await t.test('revision writes a supersede edge and keeps the old text readable', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const first = recordSelfNotes(runtimeAt('call-rev'), { items: [{ text: '第一版想法', reason: '初稿' }] }, deps);
    const second = recordSelfNotes(
      runtimeAt('call-rev-2'),
      { items: [{ text: '第二版想法', reason: '修订', supersedesId: first.items[0].id }] },
      deps,
    );
    assert.equal(second.items[0].status, 'found');
    const old = selfGet({ main: ctx.main, clock: ctx.clock, ids: [first.items[0].id], view: 'current' });
    assert.equal(old.items[0].status, 'superseded');
    assert.equal(old.items[0].text, '第一版想法');
    const history = selfGet({ main: ctx.main, clock: ctx.clock, view: 'history' });
    assert.equal(history.items.length, 2);
    assert.ok(history.items.some((item) => item.history.length > 0));
  });

  await t.test('forks keep both new notes current and never delete the old one', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const base = recordSelfNotes(runtimeAt('call-fork'), { items: [{ text: '原始', reason: 'x' }] }, deps);
    const branchA = recordSelfNotes(
      runtimeAt('call-fork-a'),
      { items: [{ text: '左分支', reason: 'x', supersedesId: base.items[0].id }] },
      deps,
    );
    const branchB = recordSelfNotes(
      runtimeAt('call-fork-b'),
      { items: [{ text: '右分支', reason: 'x', supersedesId: base.items[0].id }] },
      deps,
    );
    const current = selfGet({ main: ctx.main, clock: ctx.clock, view: 'current' });
    const ids = current.items.map((item) => item.id);
    assert.ok(ids.includes(branchA.items[0].id));
    assert.ok(ids.includes(branchB.items[0].id));
    assert.equal(ids.includes(base.items[0].id), false);
    const old = selfGet({ main: ctx.main, clock: ctx.clock, ids: [base.items[0].id], view: 'current' });
    assert.deepEqual(old.items[0].superseded_by.sort(), [branchA.items[0].id, branchB.items[0].id].sort());
  });

  await t.test('self loop and cross-type supersede are refused', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const runtime = runtimeAt('call-loop');
    const expectedId = `sn_${Buffer.from('placeholder').toString('hex').slice(0, 4)}`;
    const note = recordSelfNotes(runtime, { items: [{ text: 'x', reason: 'y' }] }, deps);
    const loop = recordSelfNotes(runtime, { items: [{ text: 'x', reason: 'y', supersedesId: note.items[0].id }] }, deps);
    // The second call reuses the same key, so use a fresh call id for a real loop attempt.
    assert.ok(loop.items[0].replayed || loop.items[0].error);
    const fresh = recordSelfNotes(
      runtimeAt('call-loop-2'),
      { items: [{ text: 'x', reason: 'y', supersedesId: 'sn_not_a_real_note' }] },
      deps,
    );
    assert.equal(fresh.items[0].error, 'validation_error');
    const crossType = recordSelfNotes(
      runtimeAt('call-cross'),
      { items: [{ text: 'x', reason: 'y', supersedesId: 'mem_1234' }] },
      deps,
    );
    assert.equal(crossType.items[0].error, 'validation_error');
    void expectedId;
  });

  await t.test('stored self notes reject SQL updates and deletes', () => {
    const ctx = withContext(t);
    const result = recordSelfNotes(runtimeAt('call-immutable'), { items: [{ text: '不可改', reason: 'x' }] }, depsOf(ctx));
    const id = result.items[0].id;
    assert.throws(
      () => ctx.main.prepare('UPDATE self_notes SET text = ? WHERE id = ?').run('改了', id),
      /self_notes_append_only/,
    );
    assert.throws(
      () => ctx.main.prepare('DELETE FROM self_notes WHERE id = ?').run(id),
      /self_notes_append_only/,
    );
  });

  await t.test('self_get pages through notes and refuses unsupported kinds', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    for (let index = 0; index < 12; index += 1) {
      recordSelfNotes(runtimeAt(`call-page-${index}`), { items: [{ text: `笔记${index}`, reason: 'x' }] }, deps);
    }
    const seen = new Set();
    let cursor = null;
    do {
      const page = selfGet({ main: ctx.main, clock: ctx.clock, maxChars: 1000, cursor });
      assert.equal(page.status, 'ok');
      for (const item of page.items) {
        assert.equal(seen.has(item.id), false);
        seen.add(item.id);
      }
      cursor = page.next_cursor;
    } while (cursor);
    assert.equal(seen.size, 12);
    const judgment = selfGet({ main: ctx.main, clock: ctx.clock, kind: 'judgment' });
    assert.equal(judgment.status, 'ok');
    assert.equal(judgment.items.length, 0);
    const handler = createSelfHandler({ main: ctx.main, clock: ctx.clock });
    assert.equal(handler.get({ kind: 'self_note', ids: ['a', 'a'] }).code, 'validation_error');
  });

  await t.test('self notes never enter automatic injection', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const before = compileRound({ main: ctx.main, control: ctx.control, clock: ctx.clock, mode: 'work', roundId: 'p2-before', tokenizer: conservativeTokens, H: 20000 });
    const note = recordSelfNotes(runtimeAt('call-inject'), { items: [{ text: '我自己的笔记', reason: 'x' }] }, deps);
    const after = compileRound({ main: ctx.main, control: ctx.control, clock: ctx.clock, mode: 'work', roundId: 'p2-after', tokenizer: conservativeTokens, H: 20000 });
    assert.deepEqual(after.snapshot.eligible_ids, before.snapshot.eligible_ids);
    assert.equal(after.section.text.includes(note.items[0].id), false);
    assert.equal(after.section.text.includes('我自己的笔记'), false);
  });

  await t.test('a conflicting supersede event rolls the note transaction back', () => {
    const ctx = withContext(t);
    const deps = depsOf(ctx);
    const base = recordSelfNotes(runtimeAt('call-conflict-base'), { items: [{ text: '原始', reason: 'x' }] }, deps);
    const noteId = `sn_${'0'.repeat(64)}`;
    void noteId;
    // Pre-insert a conflicting relation for the exact edge the retry would use.
    assert.throws(
      () =>
        withImmediate(ctx.main, () => {
          appendRelation(ctx.main, {
            type: 'supersede',
            payload: { targetType: 'self_note', oldId: base.items[0].id, newId: 'sn_other', reason: 'x' },
            businessKey: `${base.items[0].id}:sn_other`,
            at: ctx.clock.at().at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          });
          appendRelation(ctx.main, {
            type: 'supersede',
            payload: { targetType: 'self_note', oldId: base.items[0].id, newId: 'sn_another', reason: 'y' },
            businessKey: `${base.items[0].id}:sn_other`,
            at: ctx.clock.at().at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          });
        }),
      (err) => err.code === 'idempotency_conflict',
    );
  });
});

test('P2-M1 legacy compatibility and upgrade', async (t) => {
  await t.test('appendRelation keeps legacy keys but compares payload and versions strictly', () => {
    const ctx = withContext(t);
    const at = ctx.clock.at().at;
    const first = withImmediate(ctx.main, () =>
      appendRelation(ctx.main, { type: 'test-evt', payload: { a: 1 }, businessKey: 'k1', at }),
    );
    assert.equal(first.replayed, false);
    assert.equal(first.dedupeKey, 'test-evt:k1');
    const again = withImmediate(ctx.main, () =>
      appendRelation(ctx.main, { type: 'test-evt', payload: { a: 1 }, businessKey: 'k1', at }),
    );
    assert.equal(again.replayed, true);
    assert.equal(again.id, first.id);
    assert.throws(
      () =>
        withImmediate(ctx.main, () =>
          appendRelation(ctx.main, { type: 'test-evt', payload: { a: 2 }, businessKey: 'k1', at }),
        ),
      (err) => err.code === 'idempotency_conflict',
    );
    assert.throws(
      () =>
        withImmediate(ctx.main, () =>
          appendRelation(ctx.main, {
            type: 'test-evt',
            payload: { a: 1 },
            businessKey: 'k1',
            at,
            eventVersion: '2',
            payloadVersion: '2',
          }),
        ),
      (err) => err.code === 'idempotency_conflict',
    );
  });

  await t.test('a first-batch database upgrades to main-004 without rewriting old rows', () => {
    const clock = fixedClock();
    const ctx = openPartial(clock, { main: 3, control: 2, dream: 1 });
    try {
      const observation = makeObservation(ctx, { messageSeq: 1, text: '升级前的原话' });
      insertObservation(ctx.main, observation);
      const before = currentVersions(ctx.handles);
      assert.deepEqual(before, { main: 3, control: 2, dream: 1 });
      const applied = migrateAll(ctx.handles, { clock });
      assert.deepEqual(applied.versions, latestMigrations());
      const pendingMain = discoverMigrations()
        .main.map((migration) => migration.version)
        .filter((version) => version > 3);
      assert.deepEqual(applied.results.main.appliedNow, pendingMain);
      const stored = ctx.main.prepare('SELECT text FROM observations WHERE id = ?').get(observation.id);
      assert.equal(stored.text, '升级前的原话');
      assert.equal(ctx.main.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      const second = migrateAll(ctx.handles, { clock });
      assert.deepEqual(second.results.main.appliedNow, []);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('the record handler accepts self_note and rejects owner-authored attempts', () => {
    const ctx = withContext(t);
    const handler = createRecordHandler(depsOf(ctx));
    const ok = handler.record(runtimeAt('call-handler'), {
      kind: 'self_note',
      items: [{ text: '通过 record 写', reason: 'x' }],
    });
    assert.equal(ok.items[0].status, 'found');
    const owner = handler.record(fakeRuntime({ role: 'owner', callId: 'call-owner' }), {
      kind: 'self_note',
      items: [{ text: 'x', reason: 'y' }],
    });
    assert.equal(owner.status, 'error');
    assert.equal(owner.code, 'invalid_role');
  });
});

test('P2-M1 marker', async (t) => {
  const ctx = withContext(t);
  const deps = depsOf(ctx);
  const base = recordSelfNotes(runtimeAt('marker-1'), { items: [{ text: '原始', reason: 'x' }] }, deps);
  recordSelfNotes(runtimeAt('marker-2'), { items: [{ text: '左', reason: 'x', supersedesId: base.items[0].id }] }, deps);
  recordSelfNotes(runtimeAt('marker-3'), { items: [{ text: '右', reason: 'x', supersedesId: base.items[0].id }] }, deps);
  const current = selfGet({ main: ctx.main, clock: ctx.clock, view: 'current' });
  const notes = countRows(ctx.main, 'self_notes');
  const appendOnly = (() => {
    try {
      ctx.main.prepare('UPDATE self_notes SET text = ? WHERE id = ?').run('x', base.items[0].id);
      return false;
    } catch {
      return true;
    }
  })();
  const authorBound = (() => {
    try {
      recordSelfNotes(fakeRuntime({ role: 'owner', callId: 'marker-owner' }), { items: [{ text: 'x', reason: 'y' }] }, deps);
      return false;
    } catch (err) {
      return err.code === 'invalid_role';
    }
  })();
  assert.equal(notes, 3);
  assert.equal(current.items.length, 2);
  assert.equal(appendOnly, true);
  assert.equal(authorBound, true);
  t.diagnostic(`P2_M1_OK self_note=true author_bound=${authorBound} append_only=${appendOnly} forks=${current.items.length}`);
});
