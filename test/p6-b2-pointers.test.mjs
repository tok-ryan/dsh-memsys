import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { applyPlan, buildPlan, verifyPlan } from '../src/import/legacy.mjs';
import { applyPointers, planPointers } from '../src/import/pointers.mjs';
import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll } from '../src/storage/open.mjs';
import { migrateAll } from '../src/storage/migrate.mjs';
import { seedInitialRegistry } from '../src/storage/repositories.mjs';
import { canonicalJson } from '../src/identity.mjs';
import { mutableClock } from './helpers/fixtures.mjs';

function legacyCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p6b2-'));
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

test('P6/B2: changing a source byte blocks pointer apply before relation write', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const raw = '真实原文';
  const record = { id: 'b2p', kind: 'point', raw, gist: '摘要', why: 'w', type: 'fact', scene: 'work', scope: 'work-only', pointer: { status: 'unknown' } };
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records: [record], graph: { nodes: [], edges: [] } }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  const item = plan.items.find((entry) => entry.itemKind === 'memory');
  const bytes = Buffer.from(raw, 'utf8');
  const file = path.join(ctx.source, 'b2p.md');
  fs.writeFileSync(file, bytes);
  const versions = path.join(ctx.source, 'versions.json');
  fs.writeFileSync(versions, JSON.stringify({ versions: [{
    sourceObjectId: 'b2p', versionHash: item.sourceVersionHash,
    location: file + '#bytes:0-' + bytes.length,
    file, span: { start: 0, end: bytes.length },
    spanHash: crypto.createHash('sha256').update(bytes).digest('hex'),
  }] }), 'utf8');
  const pointerPlan = planPointers({ main: ctx.handles.main, clock: ctx.clock }, versions);
  assert.equal(pointerPlan.items.length, 1, JSON.stringify(pointerPlan.skipped));
  fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from('x')]));
  assert.throws(
    () => applyPointers({ main: ctx.handles.main, clock: ctx.clock }, pointerPlan),
    (err) => err.code === 'source_bytes_changed',
  );
  const changes = ctx.handles.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'pointer-change' AND json_extract(payload, '$.basis') = 'pointer-backfill'").get().n;
  assert.equal(Number(changes), 0);
});

test('P6/B2: changed graph node label makes verifyPlan fail', (t) => {
  const ctx = legacyCtx();
  t.after(() => ctx.cleanup());
  const record = { id: 'b2g', kind: 'point', raw: '文本', gist: '摘要', why: 'w', type: 'fact', scene: 'work', scope: 'work-only', pointer: { status: 'unknown' } };
  const graph = { nodes: [{ id: 'n1', label: '旧标签', kind: 'concept' }], edges: [] };
  fs.writeFileSync(path.join(ctx.source, 'legacy.json'), JSON.stringify({ records: [record], graph }), 'utf8');
  const plan = buildPlan(ctx.source);
  applyPlan(ctx.deps, plan);
  ctx.handles.main.exec('DROP TRIGGER IF EXISTS trg_graph_nodes_no_update');
  ctx.handles.main.prepare('UPDATE graph_nodes SET label = ? WHERE id = ?').run('新标签', 'n1');
  const verify = verifyPlan({ main: ctx.handles.main, clock: ctx.clock }, plan);
  assert.equal(verify.status, 'failed');
  assert.ok(verify.missing.some((entry) => entry.includes('graph_node_content')), JSON.stringify(verify.missing));
});
