import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'acceptance-boundaries.mjs');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('P3-C4 require-live distinguishes not-run from failed', async (t) => {
  await t.test('no dynamic evidence exits non-zero with dynamic_not_run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c4live-'));
    try {
      const out = path.join(dir, 'live.json');
      const result = run(['--require-live', '--out', out]);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /GATES_FAILED reason=dynamic_not_run/);
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(report.dynamic.status, 'not_run');
      assert.equal(report.dynamic.reason, 'dynamic_not_run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('a present but failed dynamic report exits with dynamic_failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c4live-'));
    try {
      const live = path.join(dir, 'live-failed.json');
      fs.writeFileSync(live, JSON.stringify({ status: 'failed', evidence: 'tool registration probe failed' }), 'utf8');
      const result = run(['--require-live', '--live-report', live]);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /GATES_FAILED reason=dynamic_failed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('a passed dynamic report is the only way to GATES_OK', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c4live-'));
    try {
      const live = path.join(dir, 'live-passed.json');
      fs.writeFileSync(live, JSON.stringify({
        status: 'passed',
        case: 'tools',
        registration: { status: 'registered' },
        tools: { result: 'ok', schemas_has_memsys: true, get_found: true },
        evidence: 'probe',
      }), 'utf8');
      const result = run(['--require-live', '--live-report', live]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /GATES_OK mode=require-live dynamic=passed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('offline mode never promotes dynamic capability', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-c4live-'));
    try {
      const out = path.join(dir, 'offline.json');
      const result = run(['--offline', '--out', out]);
      assert.equal(result.status, 0);
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(report.dynamic.status, 'unknown');
      for (const capability of Object.values(report.capabilities)) {
        assert.notEqual(capability.status, 'passed');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
