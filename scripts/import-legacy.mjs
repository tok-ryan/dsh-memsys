#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const valueAfter = (argv, flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const required = (value, usage) => {
  if (!value) {
    console.error(usage);
    process.exit(2);
  }
  return value;
};
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const argv = process.argv.slice(2);
const command = argv[0];
const { resolveConfig } = await load('src/config.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { discoverMigrations, migrateAll } = await load('src/storage/migrate.mjs');
const { seedInitialRegistry } = await load('src/storage/repositories.mjs');
const { systemClock } = await load('src/clock.mjs');
const legacy = await load('src/import/legacy.mjs');
const pointers = await load('src/import/pointers.mjs');
const { crossCheckHighWater } = await load('src/gates/checks.mjs');
const rollback = await load('src/import/rollback.mjs');

function openTarget(dataDir) {
  const config = resolveConfig({ dataDir: path.resolve(dataDir) });
  const handles = openAll(config);
  migrateAll(handles, { clock: systemClock });
  if (!handles.main.prepare('SELECT 1 AS ok FROM config LIMIT 1').get()) {
    handles.main.exec('BEGIN IMMEDIATE');
    try {
      seedInitialRegistry(handles.main, systemClock);
      handles.main.exec('COMMIT');
    } catch (err) {
      handles.main.exec('ROLLBACK');
      throw err;
    }
  }
  return { config, handles, clock: systemClock };
}

async function main() {
  if (command === 'plan') {
    const source = required(valueAfter(argv, '--source'), 'USAGE: plan --source <dir> --out <plan.json>');
    const out = required(valueAfter(argv, '--out'), 'USAGE: plan --source <dir> --out <plan.json>');
    const plan = legacy.buildPlan(source);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    console.log(`IMPORT_PLAN_OK items=${plan.items.length} quarantined=${plan.quarantined.length} planHash=${plan.planHash.slice(0, 16)}`);
    return;
  }

  if (command === 'apply') {
    const planFile = required(valueAfter(argv, '--plan'), 'USAGE: apply --plan <plan.json> --data-dir <dir>');
    const dataDir = required(valueAfter(argv, '--data-dir'), 'USAGE: apply --plan <plan.json> --data-dir <dir>');
    const plan = legacy.loadPlan(path.resolve(planFile));
    const { handles, clock } = openTarget(dataDir);
    try {
      const result = legacy.applyPlan({ main: handles.main, control: handles.control, clock }, plan);
      console.log(`IMPORT_OK appliedNow=${result.appliedNow.length} reused=${result.reused.length} quarantined=${result.quarantined}`);
    } finally {
      closeAll(handles);
    }
    return;
  }

  if (command === 'verify') {
    const planFile = required(valueAfter(argv, '--plan'), 'USAGE: verify --plan <plan.json> --data-dir <dir>');
    const dataDir = required(valueAfter(argv, '--data-dir'), 'USAGE: verify --plan <plan.json> --data-dir <dir>');
    const plan = legacy.loadPlan(path.resolve(planFile));
    const { handles, clock } = openTarget(dataDir);
    try {
      const report = legacy.verifyPlan({ main: handles.main, clock }, plan);
      if (report.status !== 'ok') {
        console.error(`IMPORT_VERIFY_FAILED missing=${report.missing.length}`);
        for (const missing of report.missing.slice(0, 10)) console.error(`  ${missing}`);
        process.exitCode = 1;
        return;
      }
      const reportFile = path.join(path.resolve(dataDir), 'verify-report.json');
      fs.writeFileSync(reportFile, `${JSON.stringify({ ...report, planHash: plan.planHash }, null, 2)}\n`, 'utf8');
      console.log(`IMPORT_VERIFY_OK unresolved=${report.unresolved} items=${report.items} graph_nodes=${report.graph_nodes} graph_edges=${report.graph_edges}`);
    } finally {
      closeAll(handles);
    }
    return;
  }

  if (command === 'pointer-plan') {
    const versions = required(valueAfter(argv, '--versions'), 'USAGE: pointer-plan --versions <versions.json> --data-dir <dir> --out <pointers.json>');
    const dataDir = required(valueAfter(argv, '--data-dir'), 'USAGE: pointer-plan --versions <versions.json> --data-dir <dir> --out <pointers.json>');
    const out = required(valueAfter(argv, '--out'), 'USAGE: pointer-plan --versions <versions.json> --data-dir <dir> --out <pointers.json>');
    const { handles, clock } = openTarget(dataDir);
    try {
      const plan = pointers.planPointers({ main: handles.main, clock }, path.resolve(versions));
      fs.writeFileSync(path.resolve(out), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
      console.log(`POINTER_PLAN_OK items=${plan.items.length} skipped=${plan.skipped.length}`);
    } finally {
      closeAll(handles);
    }
    return;
  }

  if (command === 'pointer-apply') {
    const planFile = required(valueAfter(argv, '--plan'), 'USAGE: pointer-apply --plan <pointers.json> --data-dir <dir>');
    const dataDir = required(valueAfter(argv, '--data-dir'), 'USAGE: pointer-apply --plan <pointers.json> --data-dir <dir>');
    const plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8'));
    const { handles, clock } = openTarget(dataDir);
    try {
      const result = pointers.applyPointers({ main: handles.main, clock }, plan);
      console.log(`POINTER_APPLY_OK applied=${result.applied.length} skipped=${result.skipped}`);
    } finally {
      closeAll(handles);
    }
    return;
  }

  if (command === 'cutover-check' || command === 'activate') {
    const planFile = required(valueAfter(argv, '--plan'), 'USAGE: cutover-check --plan <plan.json> --data-dir <dir> --restore-report <report.json>');
    const dataDir = required(valueAfter(argv, '--data-dir'), 'USAGE: cutover-check --plan <plan.json> --data-dir <dir> --restore-report <report.json>');
    const restoreReport = required(valueAfter(argv, '--restore-report'), 'USAGE: cutover-check --plan <plan.json> --data-dir <dir> --restore-report <report.json>');
    const deploymentDir = valueAfter(argv, '--deployment-dir');
    const plan = legacy.loadPlan(path.resolve(planFile));
    const restore = JSON.parse(fs.readFileSync(path.resolve(restoreReport), 'utf8'));
    if (!(restore.hash === true && restore.integrity === true && restore.ledger_preserved === true)) {
      console.log(`CUTOVER_BLOCKED restore_unverified batch=${restore.selected_batch ?? 'unknown'}`);
      process.exitCode = 1;
      return;
    }
    const { handles, clock } = openTarget(dataDir);
    let verify;
    try {
      verify = legacy.verifyPlan({ main: handles.main, clock }, plan);
    } finally {
      closeAll(handles);
    }
    const gate = legacy.cutoverGate(verify);
    if (gate) {
      console.log(`CUTOVER_BLOCKED ${gate} missing=${verify.missing.length} unresolved=${verify.unresolved}`);
      process.exitCode = 1;
      return;
    }
    const target = openTarget(dataDir);
    let targetMain = 0;
    let targetControl = 0;
    try {
      targetMain = Number(target.handles.main.prepare('SELECT COALESCE(MAX(commit_seq), 0) AS s FROM relations').get().s);
      targetControl = Number(target.handles.control.prepare('SELECT COALESCE(MAX(generation), 0) AS g FROM operations').get().g);
    } finally {
      closeAll(target.handles);
    }
    const cross = crossCheckHighWater({
      restoreReport: restore,
      targetMainSeq: targetMain,
      targetControlGeneration: targetControl,
    });
    if (!cross.ok) {
      console.log(`CUTOVER_BLOCKED high_water_${cross.reason}`);
      process.exitCode = 1;
      return;
    }
    const verifyHash = sha256(JSON.stringify(verify));
    if (command === 'cutover-check') {
      const cutoverFile = path.join(path.resolve(dataDir), 'cutover.json');
      fs.writeFileSync(cutoverFile, `${JSON.stringify({ planHash: plan.planHash, verifyHash, restoreBatch: restore.selected_batch, at: systemClock.at().at }, null, 2)}\n`, 'utf8');
      console.log('CUTOVER_READY');
      return;
    }
    required(deploymentDir, 'USAGE: activate --plan <plan.json> --data-dir <dir> --restore-report <report.json> --deployment-dir <dir>');
    const activateTarget = openTarget(dataDir);
    let businessRows = null;
    try {
      businessRows = rollback.snapshotBusinessRows(activateTarget.handles.main);
    } finally {
      closeAll(activateTarget.handles);
    }
    fs.mkdirSync(path.resolve(deploymentDir), { recursive: true });
    fs.writeFileSync(
      path.join(path.resolve(deploymentDir), 'config.json'),
      `${JSON.stringify({
        dataDir: path.resolve(dataDir),
        planHash: plan.planHash,
        verifyHash,
        restoreBatch: restore.selected_batch,
        business_counts: businessRows?.counts ?? null,
        business_rows: businessRows,
        activatedAt: systemClock.at().at,
      }, null, 2)}\n`,
      'utf8',
    );
    console.log('ACTIVATE_OK');
    return;
  }

  if (command === 'rollback-check') {
    const deploymentDir = required(valueAfter(argv, '--deployment-dir'), 'USAGE: rollback-check --deployment-dir <dir> --restore-report <report.json>');
    const restoreReport = required(valueAfter(argv, '--restore-report'), 'USAGE: rollback-check --deployment-dir <dir> --restore-report <report.json>');
    const configFile = path.join(path.resolve(deploymentDir), 'config.json');
    if (!fs.existsSync(configFile)) {
      console.log('ROLLBACK_CHECK_FAILED no_deployment');
      process.exitCode = 1;
      return;
    }
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const restore = JSON.parse(fs.readFileSync(path.resolve(restoreReport), 'utf8'));
    if (!config.dataDir || restore.hash !== true) {
      console.log('ROLLBACK_CHECK_FAILED');
      process.exitCode = 1;
      return;
    }
    const restoredDir = restore.restore_dir;
    if (!restoredDir || !fs.existsSync(restoredDir)) {
      console.log('ROLLBACK_CHECK_FAILED restore_dir_missing');
      process.exitCode = 1;
      return;
    }
    const restored = openAll(resolveConfig({ dataDir: restoredDir }));
    let comparison;
    try {
      comparison = config.business_rows
        ? rollback.compareBusinessRows({ db: restored.main, baseline: config.business_rows })
        : rollback.compareBusinessCounts({
            db: restored.main,
            expected: config.business_counts ?? {},
          });
    } finally {
      closeAll(restored);
    }
    if (!comparison.ok) {
      console.log(`ROLLBACK_CHECK_FAILED business_missing=${comparison.missing.join(',')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`ROLLBACK_CHECK_OK deployment=${path.basename(path.resolve(deploymentDir))} restore_batch=${restore.selected_batch ?? 'unknown'} business_rows=${Object.keys(comparison.counts).length}`);
    return;
  }

  console.error('USAGE: import-legacy.mjs plan|apply|verify|pointer-plan|pointer-apply|cutover-check|activate|rollback-check ...');
  process.exit(2);
}

await main();
