import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { closeAll, openAll, withImmediate } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll } from '../src/storage/migrate.mjs';
import {
  insertCandidate,
  insertMemory,
  insertObservation,
  insertPointer,
  insertTimeline,
  seedInitialRegistry,
} from '../src/storage/repositories.mjs';
import { requestDueRetreat } from '../src/write/due-actions.mjs';
import { SURFACE_CALIBRATION_TODO, SURFACE_METRIC, SURFACE_THRESHOLD } from '../src/dream/surface.mjs';
import { crossCheckHighWater } from '../src/gates/checks.mjs';
import { searchMemories } from '../src/read/search.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'acceptance-boundaries.mjs');

function gateReport(dir) {
  const out = path.join(dir, 'boundaries.json');
  const run = spawnSync(process.execPath, [CLI, '--offline', '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GATES_OK mode=offline/);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('P3-C4 boundary gates are executable and can fail', async (t) => {
  await t.test('offline gate report keeps unknown capabilities unknown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c4-'));
    try {
      const report = gateReport(dir);
      assert.equal(report.offline_passed, true);
      const ids = report.gates.map((gate) => gate.id);
      for (const id of ['tool_registration', 'due_retreat', 'dream_surface_threshold', 'cutover_high_water', 'evidence_mean_null', 'require_live']) {
        assert.ok(ids.includes(id), id);
      }
      const tool = report.gates.find((gate) => gate.id === 'tool_registration');
      assert.equal(tool.status, 'passed');
      assert.equal(tool.evidence.capability.status, 'unknown');
      assert.equal(report.capabilities.tool_registration.status, 'unknown');
      assert.equal(report.dynamic.status, 'unknown');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('due retreat is unreachable and writes nothing before policy approval', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    try {
      const retreat = requestDueRetreat(ctx.main);
      assert.equal(retreat.ok, false);
      assert.equal(retreat.code, 'due_retreat_unavailable');
      assert.equal(retreat.reason, 'policy_not_approved');
      assert.equal(ctx.main.prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'due-retreat'").get().n, 0);
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('dream surface records the freshness metric and a recalibration todo', () => {
    assert.equal(SURFACE_METRIC, 'freshness');
    assert.equal(SURFACE_THRESHOLD, 0.45);
    assert.match(SURFACE_CALIBRATION_TODO, /full R/);
  });

  await t.test('cutover high-water cross-check rejects lower and missing evidence', () => {
    const report = { restored_main_commit_seq: 5, restored_control_generation: 2 };
    assert.equal(crossCheckHighWater({ restoreReport: report, targetMainSeq: 5, targetControlGeneration: 2 }).ok, true);
    assert.equal(crossCheckHighWater({ restoreReport: report, targetMainSeq: 4 }).ok, false);
    assert.equal(crossCheckHighWater({ restoreReport: {}, targetMainSeq: 5 }).ok, false);
  });

  await t.test('search keeps evidence_mean null and says why', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    try {
      const observation = makeObservation(ctx, { messageSeq: 70001, text: '边界探针：记忆里的门牌' });
      insertObservation(ctx.main, observation);
      const candidate = makeCandidate(ctx, observation, { businessKey: 'c4-probe', text: '边界探针记忆' });
      insertCandidate(ctx.main, candidate);
      const memory = makeMemory(ctx, candidate);
      insertMemory(ctx.main, memory);
      insertTimeline(ctx.main, { memory_id: memory.id, start_at: null, end_at: null, prec_start: 'unknown', prec_end: 'unknown', time_state: 'point', revision: 1 });
      insertPointer(ctx.main, { memory_id: memory.id, status: 'unknown', location: null, search_hint: null, lossy: 0, revision: 1 });
      const result = searchMemories({
        main: ctx.main,
        clock: ctx.clock,
        keywords: ['边界探针'],
        scene: null,
        topicKey: null,
        timeRange: null,
        graph: null,
      });
      assert.ok(result.direct_hit_count >= 1);
      assert.equal(typeof result.evidence_mean, 'number');
      assert.equal(result.evidence_mean_status, 'ok');
      assert.equal(result.relation_search, 'unavailable');
      assert.match(result.evidence_formula, /doorplate/);
      const zero = searchMemories({ main: ctx.main, clock: ctx.clock, keywords: ['完全不存在'], scene: null, topicKey: null, timeRange: null, graph: null });
      assert.equal(zero.direct_hit_count, 0);
      assert.equal(zero.evidence_mean, null);
      assert.equal(zero.evidence_mean_status, 'unavailable');
    } finally {
      ctx.cleanup();
    }
  });
});
