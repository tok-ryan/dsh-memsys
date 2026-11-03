import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
} from '../src/storage/repositories.mjs';
import { mergeExact } from '../src/dream/organize.mjs';
import { buildPlan, applyPlan, verifyPlan, cutoverGate } from '../src/import/legacy.mjs';
import { planPointers } from '../src/import/pointers.mjs';
import { compareBusinessCounts } from '../src/import/rollback.mjs';
import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll } from '../src/storage/migrate.mjs';
import { seedInitialRegistry } from '../src/storage/repositories.mjs';
import os from 'node:os';
import path from 'node:path';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

let seq = 0;

function activeMemory(ctx, overrides = {}) {
  seq += 1;
  const text = overrides.text ?? '完全相同的记忆';
  const observation = makeObservation(ctx, { messageSeq: 9600 + seq, text });
  insertObservation(ctx.main, observation);
  const candidate = makeCandidate(ctx, observation, {
    businessKey: `p4p3-${seq}`,
    text,
    why: '固定理由',
    type: 'fact',
    scene: 'work',
    scope: 'work-only',
  });
  Object.assign(candidate, {
    key_status: 'resolved',
    binding_status: 'accepted',
    binding_basis: JSON.stringify({ ruleRevision: 'topic-v1', source: 'test' }),
    origin_mode: 'self',
    semantic_status: 'quoted',
    record_kind: 'utterance',
  });
  insertCandidate(ctx.main, candidate);
  const memory = makeMemory(ctx, candidate);
  Object.assign(memory, {
    key_status: 'resolved',
    binding_status: 'accepted',
    binding_basis: candidate.binding_basis,
    origin_mode: 'self',
  });
  insertMemory(ctx.main, memory);
  insertTimeline(ctx.main, {
    memory_id: memory.id,
    start_at: overrides.startAt ?? null,
    end_at: overrides.endAt ?? null,
    prec_start: 'unknown',
    prec_end: 'unknown',
    time_state: overrides.timeState ?? 'point',
    revision: 1,
  });
  insertPointer(ctx.main, {
    memory_id: memory.id,
    status: overrides.pointerStatus ?? 'unknown',
    location: overrides.pointerLocation ?? null,
    search_hint: null,
    lossy: 0,
    revision: 1,
  });
  return memory;
}


function legacyCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p4p3-'));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source, { recursive: true });
  const clock = mutableClock().clock;
  const handles = openAll(resolveConfig({ dataDir: path.join(dir, 'target') }));
  migrateAll(handles, { clock });
  handles.main.exec('BEGIN IMMEDIATE');
  seedInitialRegistry(handles.main, clock);
  handles.main.exec('COMMIT');
  return {
    dir, source, handles, clock,
    deps: { main: handles.main, control: handles.control, clock },
    cleanup() { try { closeAll(handles); } catch {} fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('P4/P3 L5: legacy import keeps raw-missing carriers and business fields', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const records = [
    {
      id: 'raw-missing',
      kind: 'point',
      gist: '只有摘要，没有原话',
      detail: '旧 detail',
      why: '旧 why',
      type: 'preference',
      scene: 'work',
      scope: 'work-only',
      dueAt: '2026-12-01T00:00:00+08:00',
      origin: ['observed@legacy', 'master@2023-01-01'],
      pointer: { status: 'unknown' },
    },
    {
      id: 'raw-present',
      kind: 'point',
      raw: '这是真正的原话',
      gist: '摘要',
      detail: 'detail 二',
      why: 'why 二',
      type: 'fact',
      scene: 'work',
      scope: 'work-only',
      origin: ['observed@legacy'],
      pointer: { status: 'unknown' },
    },
  ];
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records, graph: { nodes: [], edges: [] } }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  const missingObs = ctx.handles.main
    .prepare('SELECT * FROM observations WHERE idempotency_key LIKE ?')
    .get('obs:import:whale-soul:raw-missing%');
  assert.ok(missingObs, 'raw-missing observation exists');
  assert.notEqual(missingObs.text, '只有摘要，没有原话', 'gist must not replace the raw carrier');
  assert.equal(missingObs.lossy, 1);
  const presentObs = ctx.handles.main
    .prepare('SELECT * FROM observations WHERE text = ?')
    .get('这是真正的原话');
  assert.ok(presentObs);
  const imported = ctx.handles.main.prepare('SELECT * FROM candidates WHERE text = ?').get('只有摘要，没有原话');
  assert.ok(imported, 'candidate from summary exists');
  assert.equal(imported.detail, '旧 detail');
  assert.equal(imported.type, 'preference');
  assert.equal(imported.due_at, '2026-12-01T00:00:00+08:00');
  assert.match(imported.origin, /observed@legacy/);
  const verify = verifyPlan({ main: ctx.handles.main, clock: ctx.clock }, plan);
  assert.equal(verify.status, 'ok', JSON.stringify(verify.missing));
});


test('P4/P3 L6: cutover blocks unresolved items and rollback checks real business rows', (t) => {
  assert.equal(cutoverGate({ status: 'ok', unresolved: 0 }), null);
  assert.equal(cutoverGate({ status: 'ok', unresolved: 1 }), 'unresolved_items');
  assert.equal(cutoverGate({ status: 'failed', unresolved: 1 }), 'verify_failed');

  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const expected = { observations: 1 };
  ctx.handles.main
    .prepare(
      "INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at) VALUES ('obs_l6','obs:l6',?, 'h','L6', 'file','unknown','{}','migrated',0,'{}',0.5,?)",
    )
    .run(ctx.clock.at().at, ctx.clock.at().at);
  assert.equal(compareBusinessCounts({ db: ctx.handles.main, expected }).ok, true);
  const broken = compareBusinessCounts({ db: ctx.handles.main, expected: { ...expected, memories: 2 } });
  assert.equal(broken.ok, false);
  assert.ok(broken.missing.includes('memories'));
});

test('P4/P3 E16: exact pointers require the real file version and span', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const raw = '门牌原话：这一段必须真的存在';
  const record = {
    id: 'p-e16', kind: 'point', raw, gist: '摘要', why: 'w', type: 'fact',
    scene: 'work', scope: 'work-only', pointer: { status: 'unknown' },
  };
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records: [record], graph: { nodes: [], edges: [] } }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  const item = plan.items.find((entry) => entry.itemKind === 'memory');
  const bytes = Buffer.from(raw, 'utf8');
  const realFile = path.join(ctx.source, 'p-e16.md');
  fs.writeFileSync(realFile, bytes);
  const spanHash = crypto.createHash('sha256').update(bytes).digest('hex');

  const fakeVersions = path.join(ctx.source, 'fake-versions.json');
  fs.writeFileSync(fakeVersions, JSON.stringify({ versions: [{
    sourceObjectId: 'p-e16', versionHash: item.sourceVersionHash,
    location: 'C:/legacy/does-not-exist.md#L1',
  }] }), 'utf8');
  const fakePlan = planPointers({ main: ctx.handles.main, clock: ctx.clock }, fakeVersions);
  assert.equal(fakePlan.items.length, 0, 'a fake path cannot become exact');

  const realVersions = path.join(ctx.source, 'real-versions.json');
  fs.writeFileSync(realVersions, JSON.stringify({ versions: [{
    sourceObjectId: 'p-e16', versionHash: item.sourceVersionHash,
    location: realFile + '#bytes:0-' + bytes.length,
    file: realFile, span: { start: 0, end: bytes.length }, spanHash,
  }] }), 'utf8');
  const realPlan = planPointers({ main: ctx.handles.main, clock: ctx.clock }, realVersions);
  assert.equal(realPlan.items.length, 1);
  assert.equal(realPlan.items[0].location, realFile + '#bytes:0-' + bytes.length);
  assert.equal(realPlan.items[0].spanHash, spanHash);
});

test('P4/P3 L4: merge_exact rejects non-identical timeline and open due state', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const a = activeMemory(ctx, { startAt: '2026-01-01T00:00:00Z' });
  const b = activeMemory(ctx, { startAt: '2026-02-01T00:00:00Z' });
  assert.throws(
    () =>
      mergeExact(
        { main: ctx.main, control: ctx.control, clock: ctx.clock },
        { runtime: fakeRuntime({ role: 'dream', callId: 'p4p3-merge' }), ids: [a.id, b.id] },
      ),
    (err) => err.code === 'validation_error',
  );
  assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n, 2);
});
