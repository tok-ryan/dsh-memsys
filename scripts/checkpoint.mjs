#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Source checkpoints live under the project's own _build/, next to plan/acceptance.
const PACKAGE_PARENT = path.resolve(ROOT, '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const label = valueAfter(process.argv.slice(2), '--label') ?? 'checkpoint';
const dataDir = valueAfter(process.argv.slice(2), '--data-dir');
const outRoot = valueAfter(process.argv.slice(2), '--out')
  ? path.resolve(valueAfter(process.argv.slice(2), '--out'))
  : path.join(PACKAGE_PARENT, '_build', 'backup');
if (!dataDir) {
  console.error('USAGE: node scripts/checkpoint.mjs --label <M1> --data-dir <dir> [--out <dir>]');
  process.exit(2);
}

const { resolveConfig } = await load('src/config.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { backupAll, timestampLabel } = await load('src/storage/backup.mjs');
const { systemClock } = await load('src/clock.mjs');

const config = resolveConfig({ dataDir: path.resolve(dataDir) });
const batch = `${timestampLabel(systemClock)}-${label}`;
const outDir = path.join(outRoot, batch);
const sourceDir = path.join(outDir, 'source');
fs.mkdirSync(outDir, { recursive: true });

// Source checkpoint with fs.cp (no git in this workspace). Databases are copied
// only through the verified consistent backup below, never as live files.
fs.cpSync(ROOT, sourceDir, {
  recursive: true,
  filter: (src) => !src.includes(`${path.sep}node_modules`),
});

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceHashes = {};
for (const file of walk(sourceDir).sort()) {
  sourceHashes[path.relative(sourceDir, file).replace(/\\/g, '/')] = createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

const handles = openAll(config);
let backupResult;
try {
  backupResult = backupAll({ config, handles, clock: systemClock, label: batch });
} finally {
  closeAll(handles);
}

const manifest = {
  label,
  batch,
  created_at: systemClock.at().at,
  node: process.version,
  source_root: ROOT,
  source_files: sourceHashes,
  databases: backupResult.manifest,
  empty_database_marker: backupResult.manifest.empty_database_marker,
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `CHECKPOINT_OK batch=${batch} source_files=${Object.keys(sourceHashes).length} dbs=${backupResult.manifest.files.length}`,
);
