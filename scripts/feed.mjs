#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const valueAfter = (argv, flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const input = valueAfter(process.argv.slice(2), '--input');
if (!input) {
  console.error('USAGE: node scripts/feed.mjs --input <feed.json>');
  process.exit(2);
}

const { filterFeed } = await load('src/feed/filter.mjs');
const payload = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const recentDays = valueAfter(process.argv.slice(2), '--recent-days')
  ? Number(valueAfter(process.argv.slice(2), '--recent-days'))
  : payload.recentDays ?? 7;

const result = filterFeed({
  items: payload.items ?? [],
  keywords: payload.keywords,
  recentDays,
  now: new Date(),
  policyRevision: payload.policyRevision,
});

if (result.status !== 'ok') {
  console.error(JSON.stringify(result));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
