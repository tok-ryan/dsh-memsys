#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const valueAfter = (argv, flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const argv = process.argv.slice(2);
const offline = argv.includes('--offline');
const requireLive = argv.includes('--require-live');
const outFile = valueAfter(argv, '--out');
const liveReportFile = valueAfter(argv, '--live-report');
if (!offline && !requireLive) {
  console.error('USAGE: acceptance-boundaries.mjs --offline [--out <json>] | --require-live [--live-report <json>]');
  process.exit(2);
}

const { resolveConfig } = await load('src/config.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { discoverMigrations, migrateAll } = await load('src/storage/migrate.mjs');
const { seedInitialRegistry } = await load('src/storage/repositories.mjs');
const { systemClock } = await load('src/clock.mjs');
const { searchMemories } = await load('src/read/search.mjs');
const gates = await load('src/gates/checks.mjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-gates-'));
const config = resolveConfig({ dataDir: tempDir });
const handles = openAll(config);
migrateAll(handles, { clock: systemClock });
handles.main.exec('BEGIN IMMEDIATE');
try {
  seedInitialRegistry(handles.main, systemClock);
  handles.main.exec('COMMIT');
} catch (err) {
  handles.main.exec('ROLLBACK');
  throw err;
}

let liveReport = null;
if (liveReportFile) {
  liveReport = JSON.parse(fs.readFileSync(path.resolve(liveReportFile), 'utf8'));
}

const targetMain = Number(
  handles.main.prepare('SELECT COALESCE(MAX(commit_seq), 0) AS s FROM relations').get().s,
);
const searchResult = searchMemories({
  main: handles.main,
  clock: systemClock,
  keywords: ['__boundary_probe_keyword__'],
  scene: null,
  topicKey: null,
  timeRange: null,
  graph: null,
});
const restoreReport = {
  restored_main_commit_seq: targetMain,
  restored_control_generation: Number(
    handles.control.prepare('SELECT COALESCE(MAX(generation), 0) AS g FROM operations').get().g,
  ),
};

const results = [
  gates.gateToolRegistration({ liveReport }),
  gates.gateDueRetreat({ main: handles.main }),
  gates.gateDreamSurface(),
  gates.gateCutoverHighWater({
    restoreReport,
    targetMainSeq: targetMain,
    targetControlGeneration: restoreReport.restored_control_generation,
  }),
  gates.gateEvidenceMean({ searchResult }),
  gates.gateRequireLive({ requireLive, liveReport }),
];
closeAll(handles);
fs.rmSync(tempDir, { recursive: true, force: true });

const offlineGates = results.filter((gate) => gate.id !== 'require_live');
const dynamicGate = results.find((gate) => gate.id === 'require_live');
const offlineOk = offlineGates.every((gate) => gate.ok);
const report = {
  generated_at: systemClock.at().at,
  mode: requireLive ? 'require-live' : 'offline',
  offline_passed: offlineOk,
  dynamic: {
    status: dynamicGate.dynamic_status,
    reason: dynamicGate.reason,
    assertion: dynamicGate.assertion,
  },
  capabilities: {
    tool_registration: { status: results[0].capability_status, note: results[0].capability_status === 'passed' ? 'dynamic evidence supplied' : 'host registration remains unverified' },
    delivery: { status: 'unknown' },
    live_tools: { status: 'unknown' },
  },
  gates: results.map((gate) => ({
    id: gate.id,
    status: gate.ok ? 'passed' : 'failed',
    assertion: gate.assertion,
    evidence: gate.evidence ?? null,
  })),
};

if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (!offlineOk) {
  console.log(`GATES_FAILED reason=offline_gate_failed failed=${offlineGates.filter((gate) => !gate.ok).map((gate) => gate.id).join(',')}`);
  process.exit(1);
}
if (requireLive) {
  if (!dynamicGate.ok) {
    console.log(`GATES_FAILED reason=${dynamicGate.reason}`);
    process.exit(dynamicGate.dynamic_status === 'failed' ? 3 : 2);
  }
  console.log('GATES_OK mode=require-live dynamic=passed');
  process.exit(0);
}
console.log(`GATES_OK mode=offline gates=${offlineGates.length} dynamic=unknown`);
process.exit(0);
