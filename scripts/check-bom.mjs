#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.sql', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const rootArgIndex = process.argv.indexOf('--root');
const root = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : ROOT;
const files = walk(root).sort();

const problems = [];
let bomCount = 0;
let invalidCount = 0;
let replacementCount = 0;

const decoder = new TextDecoder('utf-8', { fatal: true });
for (const file of files) {
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bomCount += 1;
    problems.push(`BOM ${path.relative(root, file)}`);
  }
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    invalidCount += 1;
    problems.push(`INVALID_UTF8 ${path.relative(root, file)}`);
    continue;
  }
  if (text.includes('\uFFFD')) {
    replacementCount += 1;
    problems.push(`REPLACEMENT_CHAR ${path.relative(root, file)}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(
    `UTF8_FAIL files=${files.length} BOM=${bomCount} invalid_utf8=${invalidCount} replacement=${replacementCount}`,
  );
  process.exit(1);
}

console.log(`UTF8_OK BOM=0 files=${files.length}`);
