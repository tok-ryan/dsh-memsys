#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'backup']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

let failed = false;
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (packageJson.name !== 'dsh-memsys') {
  console.error(`BUILD_FAIL package_name=${packageJson.name}`);
  failed = true;
}
if (packageJson.type !== 'module') {
  console.error('BUILD_FAIL package_type_not_module');
  failed = true;
}

const files = walk(ROOT).sort();
for (const file of files) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`BUILD_FAIL syntax ${relative}`);
    console.error(result.stderr.trim());
  }
  void relative;
}

// Declared entry points must exist once delivered; M1 has no index.mjs yet.
const entry = packageJson.exports?.['.'];
if (entry) {
  const entryPath = path.join(ROOT, String(entry).replace(/^\.\//, ''));
  if (!fs.existsSync(entryPath)) {
    failed = true;
    console.error(`BUILD_FAIL missing_entry ${entry}`);
  }
}
if (fs.existsSync(path.join(ROOT, 'index.mjs'))) {
  if (!fs.existsSync(path.join(ROOT, 'cordis.patch.yml'))) {
    failed = true;
    console.error('BUILD_FAIL missing_bundle_patch');
  }
}

if (failed) process.exit(1);
console.log(`BUILD_OK files=${files.length}`);
