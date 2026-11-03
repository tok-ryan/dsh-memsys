import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlan, applyPlan, verifyPlan } from '../src/import/legacy.mjs';
import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll } from '../src/storage/open.mjs';
import { migrateAll } from '../src/storage/migrate.mjs';
import { seedInitialRegistry } from '../src/storage/repositories.mjs';
import { mutableClock } from './helpers/fixtures.mjs';

function legacyCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p5b-'));
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

test('P5/B2: origin accepts non-arrays and version hash covers new fields', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const record = {
    id: 'b2-a', kind: 'point', raw: '旧原话', gist: '摘要', detail: '细节', why: 'w',
    type: 'preference', scene: 'work', scope: 'work-only', dueAt: '2026-05-01T00:00:00+08:00',
    origin: 'legacy:single-origin', pointer: { status: 'unknown' },
  };
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records: [record], graph: { nodes: [], edges: [] } }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  const candidate = ctx.handles.main.prepare('SELECT * FROM candidates WHERE text = ?').get('旧原话');
  assert.ok(candidate.origin.includes('legacy:single-origin'));
  assert.equal(candidate.detail, '细节');
  assert.equal(candidate.type, 'preference');
  assert.equal(candidate.due_at, '2026-05-01T00:00:00+08:00');
  const verify = verifyPlan({ main: ctx.handles.main, clock: ctx.clock }, plan);
  assert.equal(verify.status, 'ok', JSON.stringify(verify.missing));
});

test('P5/B2: missing raw evidence span matches the carrier, verify reads real rows', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const record = {
    id: 'b2-missing', kind: 'point', gist: '只有摘要', detail: 'd', why: 'w', type: 'fact',
    scene: 'work', scope: 'work-only', pointer: { status: 'unknown' },
  };
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records: [record], graph: { nodes: [], edges: [] } }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  const observation = ctx.handles.main.prepare("SELECT * FROM observations WHERE idempotency_key LIKE 'obs:import:%b2-missing%'").get();
  const evidence = ctx.handles.main.prepare('SELECT * FROM evidence WHERE observation_id = ?').get(observation.id);
  assert.equal(Number(observation.lossy), 1);
  assert.equal(evidence.source_span, `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}`);

  const pointer = ctx.handles.main.prepare('SELECT memory_id FROM pointers WHERE status = ?').get('unknown');
  ctx.handles.main.prepare('UPDATE pointers SET status = ?, location = ?, revision = revision + 1 WHERE memory_id = ?').run('exact', 'C:/tampered.md', pointer.memory_id);
  const verify = verifyPlan({ main: ctx.handles.main, clock: ctx.clock }, plan);
  assert.equal(verify.status, 'failed');
  assert.ok(verify.missing.some((entry) => entry.includes('pointer')));
});
