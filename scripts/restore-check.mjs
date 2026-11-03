#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const valueAfter = (argv, flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const argv = process.argv.slice(2);
const checkpointRoot = valueAfter(argv, '--checkpoint-root');
const dataDir = valueAfter(argv, '--data-dir');
const label = valueAfter(argv, '--label');
const outRoot = valueAfter(argv, '--out');
if (!checkpointRoot || !dataDir || !label || !outRoot) {
  console.error('USAGE: restore-check --data-dir <dir> --checkpoint-root <dir> --label <L> --out <dir>');
  process.exit(2);
}

const fail = (message) => {
  console.log(`RESTORE_CHECK_FAILED ${message}`);
  process.exitCode = 1;
};

function findBatches(root, wantedLabel) {
  if (!fs.existsSync(root)) return [];
  const batches = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(root, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      continue;
    }
    if (manifest.label !== wantedLabel) continue;
    batches.push({ dir: path.join(root, entry.name), manifest });
  }
  return batches;
}

const { resolveConfig } = await load('src/config.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { restoreToIsolated } = await load('src/storage/backup.mjs');

const batches = findBatches(path.resolve(checkpointRoot), label);
if (batches.length === 0) {
  fail(`no_checkpoint label=${label}`);
} else {
  const sorted = batches.slice().sort((a, b) => String(b.manifest.batch).localeCompare(String(a.manifest.batch)));
  if (sorted.length > 1 && sorted[0].manifest.batch === sorted[1].manifest.batch) {
    fail('ambiguous_batch_same_timestamp');
  } else {
    const selected = sorted[0];
    console.log(`SELECTED batch=${selected.manifest.batch}`);
    const manifest = selected.manifest;
    const required = ['label', 'batch', 'databases'];
    const missing = required.filter((field) => manifest[field] === undefined);
    if (missing.length > 0) {
      fail(`manifest_missing:${missing.join(',')}`);
    } else {
      const dbManifest = manifest.databases ?? {};
      if (dbManifest.main_commit_seq === undefined || dbManifest.control_generation === undefined) {
        fail('manifest_missing_high_water');
      }
      const databases = dbManifest.files;
      if (!Array.isArray(databases) || databases.length === 0) {
        fail('manifest_databases_missing');
      } else {
        const backupDirs = [
          path.join(selected.dir, 'backup', manifest.batch),
          selected.dir,
          path.join(path.resolve(dataDir), 'backup', manifest.batch),
        ];
        const firstDb = databases[0].file;
        const batchDir = backupDirs.find((dir) => fs.existsSync(path.join(dir, firstDb)));
        if (!batchDir) {
          fail('backup_files_missing');
        } else {
          let hashOk = true;
          const verifiedFiles = [];
          for (const entry of databases) {
            const file = path.join(batchDir, entry.file);
            if (!fs.existsSync(file)) {
              hashOk = false;
              verifiedFiles.push({ file: entry.file, reason: 'missing' });
              continue;
            }
            const actualBytes = fs.statSync(file).size;
            const actualHash = sha256(file);
            if (actualBytes !== entry.bytes || actualHash !== entry.sha256) {
              hashOk = false;
              verifiedFiles.push({ file: entry.file, reason: 'hash_mismatch' });
            } else {
              verifiedFiles.push({ file: entry.file, bytes: actualBytes, sha256: actualHash });
            }
          }
          if (!hashOk) {
            fail('hash_mismatch');
          } else {
            const outDir = path.resolve(outRoot);
            fs.mkdirSync(outDir, { recursive: true });
            let restoreDir = path.join(outDir, `${manifest.batch}-restore`);
            let suffix = 1;
            while (fs.existsSync(restoreDir) && fs.readdirSync(restoreDir).length > 0) {
              suffix += 1;
              restoreDir = path.join(outDir, `${manifest.batch}-restore-${suffix}`);
            }
            const restored = restoreToIsolated(batchDir, restoreDir);
            const handles = openAll(resolveConfig({ dataDir: restoreDir }));
            let integrity = true;
            let ledger = true;
            let restoredMainSeq = 0;
            let restoredControlGen = 0;
            try {
              for (const name of ['main', 'control', 'dream']) {
                const check = handles[name].prepare('PRAGMA integrity_check').get();
                const fk = handles[name].prepare('PRAGMA foreign_key_check').all();
                if (check.integrity_check !== 'ok' || fk.length > 0) integrity = false;
              }
              const mainSeq = Number(
                handles.main.prepare('SELECT COALESCE(MAX(commit_seq), 0) AS s FROM relations').get().s,
              );
              const controlGen = Number(
                handles.control.prepare('SELECT COALESCE(MAX(generation), 0) AS g FROM operations').get().g,
              );
              restoredMainSeq = mainSeq;
              restoredControlGen = controlGen;
              ledger =
                mainSeq >= Number(dbManifest.main_commit_seq) &&
                controlGen >= Number(dbManifest.control_generation);
            } finally {
              closeAll(handles);
            }
            const report = {
              status: integrity && ledger ? 'ok' : 'failed',
              selected_batch: manifest.batch,
              checkpoint_dir: selected.dir,
              restore_dir: restored.isolatedDir,
              hash: true,
              integrity,
              ledger_preserved: ledger,
              restored_main_commit_seq: restoredMainSeq,
              restored_control_generation: restoredControlGen,
              databases: verifiedFiles,
              checked_at: new Date().toISOString(),
            };
            fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            if (report.status !== 'ok') {
              fail(`integrity=${integrity} ledger=${ledger}`);
            } else {
              console.log(`RESTORE_CHECK_OK hash=true integrity=true ledger_preserved=true batch=${manifest.batch}`);
            }
          }
        }
      }
    }
  }
}
