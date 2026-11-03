#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const dataDir = valueAfter(process.argv.slice(2), '--data-dir');
const json = process.argv.includes('--json');
if (!dataDir) {
  console.error('USAGE: node scripts/migrate.mjs --data-dir <dir> [--json]');
  process.exit(2);
}

const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const { migrateAll } = await load('src/storage/migrate.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { seedInitialRegistry } = await load('src/storage/repositories.mjs');
const { systemClock } = await load('src/clock.mjs');

const handles = openAll({ dataDir: path.resolve(dataDir) });
try {
  // Precheck: an existing but damaged database is never treated as empty.
  for (const label of ['main', 'control', 'dream']) {
    const check = handles[label].prepare('PRAGMA integrity_check').get();
    if (check.integrity_check !== 'ok') {
      throw new Error(`precheck_integrity_failed:${label}:${check.integrity_check}`);
    }
  }
  const preVersions = {};
  for (const label of ['main', 'control', 'dream']) {
    try {
      preVersions[label] = Number(
        handles[label].prepare('SELECT COALESCE(MAX(version), 0) AS v FROM sqlite_master WHERE 0')
          .get().v,
      );
    } catch {
      preVersions[label] = null;
    }
  }
  void preVersions;
  const { versions, results } = migrateAll(handles, { clock: systemClock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, systemClock);
    handles.main.exec('COMMIT');
  } catch (err) {
    try {
      handles.main.exec('ROLLBACK');
    } catch {
      // Keep the original failure.
    }
    throw err;
  }
  const marker = `MIGRATIONS_OK main=${versions.main} control=${versions.control} dream=${versions.dream}`;
  if (json) {
    const appliedNow = {};
    for (const label of ['main', 'control', 'dream']) appliedNow[label] = results[label].appliedNow;
    const payload = {
      status: 'ok',
      versions,
      appliedNow,
      precheck: 'integrity_ok',
    };
    console.error(marker);
    console.log(JSON.stringify(payload));
  } else {
    console.log(marker);
  }
} finally {
  closeAll(handles);
}
