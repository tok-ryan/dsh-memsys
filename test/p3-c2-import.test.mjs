import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';

import { resolveConfig } from '../src/config.mjs';
import { openAll, closeAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll } from '../src/storage/migrate.mjs';
import { seedInitialRegistry } from '../src/storage/repositories.mjs';
import { buildPlan, applyPlan, verifyPlan, loadPlan, SOURCE_SYSTEM } from '../src/import/legacy.mjs';
import { planPointers, applyPointers } from '../src/import/pointers.mjs';
import { canonicalJson } from '../src/identity.mjs';
import { mutableClock } from './helpers/fixtures.mjs';

let seq = 0;

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c2-'));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source, { recursive: true });
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const canonical = (value) => canonicalJson(value);
  const records = [];
  for (let i = 1; i <= 24; i += 1) {
    records.push({
      id: `p${i}`,
      kind: 'point',
      raw: `旧原话第${i}条：今天在实验台记录了一个现象。`,
      gist: `旧摘要${i}`,
      why: `旧 why ${i}`,
      scene: i % 2 === 0 ? 'work' : 'life',
      scope: i % 2 === 0 ? 'work-only' : 'life-only',
      start: `2024-0${(i % 9) + 1}-1${i % 9}T09:00:00+08:00`,
      precision: 'minute',
      pointer: { status: 'unknown' },
    });
  }
  for (let i = 1; i <= 3; i += 1) {
    records.push({
      id: `i${i}`,
      kind: 'interval',
      raw: `旧区间原话${i}：持续做了一段时间的项目。`,
      gist: `旧区间摘要${i}`,
      why: null,
      scene: 'work',
      scope: 'work-only',
      start: `2023-0${i}-01T08:00:00+08:00`,
      end: `2023-0${i + 1}-01T08:00:00+08:00`,
      precision: 'day',
      pointer: { status: 'unknown' },
    });
  }
  const nodes = Array.from({ length: 8 }, (_, index) => ({ id: `n${index + 1}`, label: `旧节点${index + 1}`, kind: 'concept' }));
  const edges = Array.from({ length: 7 }, (_, index) => ({ id: `e${index + 1}`, from: `n${index + 1}`, to: `n${index + 2}`, kind: 'related' }));
  fs.writeFileSync(path.join(source, 'legacy.json'), `${JSON.stringify({ system: 'whale-soul', version: 'legacy-v1', records, graph: { nodes, edges } }, null, 2)}\n`, 'utf8');
  const filesDir = path.join(source, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const versions = records.map((record) => {
    const bytes = Buffer.from(record.raw, 'utf8');
    const file = path.join(filesDir, record.id + '.md');
    fs.writeFileSync(file, bytes);
    return {
      sourceObjectId: record.id,
      versionHash: sha(canonical({ id: record.id, raw: record.raw, gist: record.gist ?? null, detail: record.detail ?? null, type: record.type ?? null, dueAt: record.dueAt ?? null, origin: [], why: record.why, start: record.start ?? null, end: record.end ?? null })),
      location: file + '#bytes:0-' + bytes.length,
      file,
      span: { start: 0, end: bytes.length },
      spanHash: sha(bytes.toString('utf8')),
      searchHint: `search:${record.id}`,
    };
  });
  fs.writeFileSync(path.join(source, 'source-versions.json'), `${JSON.stringify({ versions }, null, 2)}\n`, 'utf8');
  return { dir, source, records };
}

function openTarget(dataDir) {
  const clock = mutableClock().clock;
  const config = resolveConfig({ dataDir });
  const handles = openAll(config);
  migrateAll(handles, { clock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  return { handles, clock, config };
}

test('P3-C2 legacy import, pointers and skeleton', async (t) => {
  await t.test('plan is deterministic and source changes block apply', () => {
    const fixture = fixtureDir();
    try {
      const first = buildPlan(fixture.source);
      const second = buildPlan(fixture.source);
      assert.equal(first.planHash, second.planHash);
      assert.equal(first.items.length, 42);
      const planFile = path.join(fixture.dir, 'plan.json');
      fs.writeFileSync(planFile, `${JSON.stringify(first, null, 2)}\n`, 'utf8');
      assert.equal(loadPlan(planFile).planHash, first.planHash);
      fs.appendFileSync(path.join(fixture.source, 'legacy.json'), ' ');
      const target = path.join(fixture.dir, 'target');
      const { handles, clock } = openTarget(target);
      try {
        assert.throws(
          () => applyPlan({ main: handles.main, control: handles.control, clock }, first),
          (err) => err.code === 'source_changed',
        );
      } finally {
        closeAll(handles);
      }
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('npm registry metadata is not accepted as legacy memory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c2-bad-'));
    try {
      fs.mkdirSync(path.join(dir, 'source'));
      fs.writeFileSync(path.join(dir, 'source', 'soul.json'), JSON.stringify({ _id: 'x', versions: {}, 'dist-tags': {} }), 'utf8');
      const plan = buildPlan(path.join(dir, 'source'));
      assert.fail('should not build a plan');
    } catch (err) {
      assert.equal(err.code, 'unsupported_legacy_format');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('apply is idempotent, raw text is preserved and graph is not evidence', () => {
    const fixture = fixtureDir();
    const target = path.join(fixture.dir, 'target');
    const { handles, clock } = openTarget(target);
    try {
      const plan = buildPlan(fixture.source);
      const first = applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      assert.equal(first.appliedNow.length, 42);
      const second = applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      assert.equal(second.appliedNow.length, 0);
      assert.equal(second.reused.length, 42);
      const verify = verifyPlan({ main: handles.main, clock }, plan);
      assert.equal(verify.status, 'ok', JSON.stringify(verify.missing));
      assert.equal(Number(handles.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n), 27);
      const observation = handles.main.prepare("SELECT text FROM observations WHERE source = 'file' ORDER BY id LIMIT 1").get();
      assert.ok(observation.text.startsWith('旧'));
      assert.equal(Number(handles.main.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get().n), 8);
      assert.equal(Number(handles.main.prepare('SELECT COUNT(*) AS n FROM graph_edges').get().n), 7);
      const evidence = handles.main.prepare('SELECT COUNT(*) AS n FROM evidence').get();
      assert.ok(Number(evidence.n) > 0);
      const graphRefs = handles.main
        .prepare("SELECT COUNT(*) AS n FROM evidence WHERE observation_id LIKE 'n%' OR observation_id LIKE 'e%'")
        .get();
      assert.equal(Number(graphRefs.n), 0);
      const pointerChanges = handles.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'pointer-change'").get();
      assert.equal(Number(pointerChanges.n), 27);
    } finally {
      closeAll(handles);
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('pointer plan matches the imported version, never the latest path', () => {
    const fixture = fixtureDir();
    const target = path.join(fixture.dir, 'target');
    const { handles, clock } = openTarget(target);
    try {
      const plan = buildPlan(fixture.source);
      applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      const versionsFile = path.join(fixture.source, 'source-versions.json');
      const versions = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
      versions.versions.push({
        sourceObjectId: 'p1',
        versionHash: 'f'.repeat(64),
        location: 'C:/legacy/latest/p1.md#L999',
        searchHint: 'search:latest',
      });
      fs.writeFileSync(versionsFile, `${JSON.stringify(versions, null, 2)}\n`, 'utf8');
      const pointerPlan = planPointers({ main: handles.main, clock }, versionsFile);
      assert.equal(pointerPlan.items.length, 27);
      const p1 = pointerPlan.items.find((item) => item.sourceObjectId === 'p1');
      assert.ok(p1.location.includes('p1.md#bytes:0-'), p1.location);
      const applied = applyPointers({ main: handles.main, clock }, pointerPlan);
      assert.equal(applied.applied.length, 27);
      const pointer = handles.main
        .prepare("SELECT p.* FROM pointers p JOIN import_items i ON json_extract(i.target_ids, '$[2]') = p.memory_id WHERE i.source_object_id = 'p1'")
        .get();
      assert.equal(pointer.status, 'exact');
      assert.ok(pointer.location.includes('p1.md#bytes:0-'), pointer.location);
      const verify = verifyPlan({ main: handles.main, clock }, plan);
      assert.equal(verify.status, 'ok');
    } finally {
      closeAll(handles);
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('marker', (t2) => {
    const fixture = fixtureDir();
    const target = path.join(fixture.dir, 'target');
    const { handles, clock } = openTarget(target);
    try {
      const plan = buildPlan(fixture.source);
      applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      const points = handles.main
        .prepare("SELECT COUNT(*) AS n FROM memories WHERE text LIKE '旧原话第%'")
        .get();
      const intervals = handles.main
        .prepare("SELECT COUNT(*) AS n FROM memories WHERE text LIKE '旧区间原话%'")
        .get();
      const unknown = handles.main
        .prepare("SELECT COUNT(*) AS n FROM pointers p JOIN memories m ON m.id = p.memory_id WHERE p.status = 'unknown' AND m.text LIKE '旧原话第%'")
        .get();
      const nodes = handles.main.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get();
      const replay = applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      assert.equal(Number(points.n), 24);
      assert.equal(Number(intervals.n), 3);
      assert.equal(Number(unknown.n), 24);
      assert.equal(Number(nodes.n), 8);
      assert.equal(replay.appliedNow.length, 0);
      t2.diagnostic(`P3_C2_OK points=${points.n} intervals=${intervals.n} unknown_pointers=${unknown.n} nodes=${nodes.n} replay_equal=true`);
    } finally {
      closeAll(handles);
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
});
