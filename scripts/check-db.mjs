#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const { openDatabase, pragmaValue } = await load('src/storage/open.mjs');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const dataDir = valueAfter(process.argv.slice(2), '--data-dir');
if (!dataDir) {
  console.error('USAGE: node scripts/check-db.mjs --data-dir <dir>');
  process.exit(2);
}

const resolved = path.resolve(dataDir);
const databases = [
  ['main', 'memsys.db'],
  ['control', 'control.db'],
  ['dream', 'dreams.db'],
];

let exitCode = 0;
const versions = {};
for (const [label, fileName] of databases) {
  const file = path.join(resolved, fileName);
  if (!fs.existsSync(file)) {
    console.log(`${label} integrity_check=missing foreign_key_check=missing migrations=0`);
    exitCode = 1;
    continue;
  }
  const db = openDatabase(file);
  try {
    const integrity = pragmaValue(db, 'integrity_check');
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    let schemaVersion = 0;
    try {
      schemaVersion = Number(
        db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v,
      );
    } catch {
      schemaVersion = 0;
    }
    versions[label] = schemaVersion;
    console.log(
      `${label} integrity_check=${integrity} foreign_key_check=${foreignKeyViolations} migrations=${schemaVersion}`,
    );
    if (integrity !== 'ok' || foreignKeyViolations !== 0) exitCode = 1;
  } finally {
    db.close();
  }
}

// Cross-library consistency: a half-migrated trio must keep business closed.
const paired =
  (versions.main >= 7 && versions.control >= 4 && versions.dream >= 2) ||
  (versions.main < 7 && versions.control < 4 && versions.dream < 2);
if (!paired) {
  console.log(
    `VERSION_MISMATCH main=${versions.main} control=${versions.control} dream=${versions.dream} business_closed=true`,
  );
  exitCode = exitCode === 0 ? 3 : exitCode;
}
process.exit(exitCode);
