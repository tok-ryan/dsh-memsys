#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const files = collect(TEST_DIR).sort();
if (files.length === 0) {
  console.error('TEST_FAIL no_offline_tests_found');
  process.exit(1);
}

// Enumerate explicitly: the runner refuses empty or silently-skipped suites.
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: ROOT,
});
if (result.error) {
  console.error(`TEST_FAIL ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
