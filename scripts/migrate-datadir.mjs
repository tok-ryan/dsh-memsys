#!/usr/bin/env node
/**
 * Idempotent data-directory migration for dsh-memsys 0.3.0.
 *
 * 0.3.0 unifies everything onto `~/.dsh/memsys`. Directories configured through
 * the old profile `data_dir` need to be moved once, by hand, with every dsh
 * process stopped (SQLite WAL locks make a live move unsafe).
 *
 * Properties this script guarantees:
 *   - refuses to move anything while a process still holds a WAL lock, and says
 *     so loudly instead of failing halfway;
 *   - never overwrites a non-empty target without a migration marker;
 *   - verifies every moved file (sha256) and every database (integrity_check +
 *     table-content digest) against fingerprints taken before the move;
 *   - writes `<target>/.migrated.json`; a rerun returns `already_migrated` and
 *     touches nothing.
 *
 * Importable from tests; runnable as:
 *   node scripts/migrate-datadir.mjs --from <old-dir> [--to <dir>] [--dry-run] [--json]
 *   node scripts/migrate-datadir.mjs --detect [--json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { defaultDataDir, resolveDataDir } from '../src/config.mjs';

export const MIGRATION_MARKER = '.migrated.json';
export const MIGRATION_SCHEMA = 'dsh-memsys-datadir-migration';
export const MIGRATION_VERSION = 1;

const SQLITE_BUSY = 5;
const LOCK_ERRNOS = new Set(['EBUSY', 'EPERM', 'EACCES']);

export class MigrationError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const isBusy = (err) =>
  Number(err?.errcode) === SQLITE_BUSY || /database is locked|SQLITE_BUSY/i.test(String(err?.message ?? err));

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function removeEmptyDirs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // a directory that is not empty stays
  }
}

/**
 * Refuse to touch a database whose WAL still has a live writer/reader.
 *
 * The probe is SQLite's own write lock: `BEGIN IMMEDIATE` with `busy_timeout=0`
 * fails with SQLITE_BUSY (errcode 5) while another process holds the lock. A
 * checkpoint that cannot truncate — or a `-shm` that survives our own close — is
 * treated as a live connection too, because a crashed process cannot hold an OS
 * lock while a running one does.
 */
export function assertNoWalLock(dbFile) {
  if (!fs.existsSync(dbFile)) return;
  const wal = `${dbFile}-wal`;
  const shm = `${dbFile}-shm`;
  const walBytes = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
  const suspicious = fs.existsSync(shm) || walBytes > 0;
  if (!suspicious) return;
  let db;
  try {
    db = new DatabaseSync(dbFile);
  } catch (err) {
    throw new MigrationError('datadir_locked', { file: dbFile, reason: String(err?.message ?? err) });
  }
  try {
    db.exec('PRAGMA busy_timeout = 0');
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (err) {
      if (isBusy(err)) {
        throw new MigrationError('datadir_locked', { file: dbFile, reason: '另一个进程持有写锁' });
      }
      throw err;
    }
    try {
      db.exec('ROLLBACK');
    } catch {
      // keep going; the lock probe already told us what we need
    }
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      if (isBusy(err)) {
        throw new MigrationError('datadir_locked', { file: dbFile, reason: 'checkpoint 被读连接挡住' });
      }
      throw err;
    }
  } finally {
    try {
      db.close();
    } catch {
      // close errors must not mask the lock verdict
    }
  }
  const remainingWal = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
  if (fs.existsSync(shm) || remainingWal > 0) {
    throw new MigrationError('datadir_locked', { file: dbFile, reason: '关闭探针后仍有打开的连接' });
  }
}

/** Deterministic digest of every table's rows (order-insensitive enough for a copy check). */
export function contentDigest(dbFile) {
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 0');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    const hash = createHash('sha256');
    for (const table of tables) {
      hash.update(`table:${table}\n`);
      const escaped = String(table).replace(/"/g, '""');
      hash.update(JSON.stringify(db.prepare(`SELECT * FROM "${escaped}"`).all()));
    }
    return hash.digest('hex');
  } finally {
    try {
      db.close();
    } catch {
      // readonly digest must not fail the caller
    }
  }
}

export function integrityOk(dbFile) {
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    return Object.values(row ?? {})[0] === 'ok';
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function readMarker(target) {
  try {
    return JSON.parse(fs.readFileSync(path.join(target, MIGRATION_MARKER), 'utf8'));
  } catch {
    return null;
  }
}

function verifyMarker(marker, target) {
  const mismatched = [];
  for (const [rel, hash] of Object.entries(marker?.files ?? {})) {
    const file = path.join(target, rel);
    if (!fs.existsSync(file) || sha256File(file) !== hash) mismatched.push(rel);
  }
  return mismatched;
}

function rollbackMoved({ source, target, moved }) {
  for (const rel of [...moved].reverse()) {
    try {
      fs.renameSync(path.join(target, rel), path.join(source, rel));
    } catch {
      // best effort: the verification error is the one the caller sees
    }
  }
  try {
    removeEmptyDirs(target);
  } catch {
    // ignore
  }
}

/**
 * Move one legacy data directory to the canonical one.
 * `dryRun` computes fingerprints and reports, without touching either side.
 */
export function migrateDataDir({ from, to = null, dryRun = false, logger = null, at = null } = {}) {
  if (!from) throw new MigrationError('from_required');
  const source = path.resolve(String(from));
  const target = path.resolve(to ? String(to) : resolveDataDir());
  if (source === target) throw new MigrationError('source_equals_target', { dir: source });
  const markerFile = path.join(target, MIGRATION_MARKER);

  // The marker is checked first: a rerun after a successful move (when the old
  // directory is already gone) must answer `already_migrated`, not `source_missing`.
  if (fs.existsSync(markerFile)) {
    const marker = readMarker(target);
    const mismatched = verifyMarker(marker ?? {}, target);
    if (mismatched.length > 0) throw new MigrationError('already_migrated_mismatch', { target, files: mismatched });
    return { status: 'already_migrated', from: marker?.from ?? null, to: target, marker };
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new MigrationError('source_missing', { from: source });
  }
  if (fs.existsSync(target)) {
    const existing = fs.readdirSync(target);
    if (existing.length > 0) throw new MigrationError('target_not_empty', { to: target });
  }

  // 1) Lock precheck before anything is read or moved.
  const preflight = listFiles(source).filter((rel) => rel.endsWith('.db'));
  for (const rel of preflight) assertNoWalLock(path.join(source, rel));

  const files = listFiles(source);
  if (files.length === 0) throw new MigrationError('source_empty', { from: source });
  const stragglers = files.filter((rel) => /\.db-(wal|shm)$/.test(rel));
  if (stragglers.length > 0) {
    throw new MigrationError('datadir_locked', { from: source, files: stragglers, reason: 'WAL 未清空' });
  }

  // 2) Fingerprints taken before the move.
  const before = { files: {}, content: {} };
  for (const rel of files) before.files[rel] = sha256File(path.join(source, rel));
  for (const rel of preflight) before.content[rel] = contentDigest(path.join(source, rel));

  if (dryRun) {
    return { status: 'dry_run', from: source, to: target, files, fingerprints: before };
  }

  // 3) Move. Same-volume rename keeps bytes; EXDEV falls back to copy+verify.
  fs.mkdirSync(target, { recursive: true });
  const moved = [];
  try {
    for (const rel of files) {
      const src = path.join(source, rel);
      const dst = path.join(target, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try {
        fs.renameSync(src, dst);
      } catch (err) {
        if (err.code === 'EXDEV') {
          fs.copyFileSync(src, dst);
          if (sha256File(dst) !== before.files[rel]) {
            fs.rmSync(dst, { force: true });
            throw new MigrationError('copy_mismatch', { file: rel });
          }
          fs.unlinkSync(src);
        } else if (LOCK_ERRNOS.has(err.code)) {
          throw new MigrationError('datadir_locked', { file: rel, reason: err.code });
        } else {
          throw err;
        }
      }
      moved.push(rel);
    }
  } catch (err) {
    rollbackMoved({ source, target, moved });
    throw err;
  }

  // 4) Prove the move: byte hashes, table content digests, integrity checks.
  const problems = [];
  for (const rel of files) {
    if (sha256File(path.join(target, rel)) !== before.files[rel]) problems.push({ file: rel, check: 'sha256' });
  }
  for (const rel of preflight) {
    const file = path.join(target, rel);
    if (contentDigest(file) !== before.content[rel]) problems.push({ file: rel, check: 'content' });
    else if (!integrityOk(file)) problems.push({ file: rel, check: 'integrity' });
  }
  if (problems.length > 0) {
    rollbackMoved({ source, target, moved });
    throw new MigrationError('verify_failed', { problems });
  }

  // 5) Idempotency marker.
  const marker = {
    schema: MIGRATION_SCHEMA,
    version: MIGRATION_VERSION,
    from: source,
    to: target,
    at: at ?? new Date().toISOString(),
    files: before.files,
    content: before.content,
  };
  const tempFile = `${markerFile}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, markerFile);

  // 6) Drop the emptied legacy tree.
  removeEmptyDirs(source);
  logger?.info?.(`[memsys] datadir migrated ${source} -> ${target} (${moved.length} files)`);
  return { status: 'migrated', from: source, to: target, files: moved, marker };
}

/**
 * Read-only discovery of old `data_dir` values in profile patches, so the owner
 * knows what to pass to `--from`.
 */
export function detectLegacyDataDirs({ profilesDir = path.join(os.homedir(), '.dsh', 'profiles') } = {}) {
  const canonical = path.resolve(defaultDataDir());
  let profiles = [];
  try {
    profiles = fs.readdirSync(profilesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const found = [];
  for (const entry of profiles) {
    for (const file of ['cordis.patch.yml', 'cordis.yml']) {
      const full = path.join(profilesDir, entry.name, file);
      let text = null;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const matches = [...text.matchAll(/^\s*data_dir:\s*["']?([^"'\s#]+)["']?/gm)];
      for (const match of matches) {
        const value = match[1];
        const dataDir = path.resolve(profilesDir, entry.name, value);
        found.push({
          profile: entry.name,
          file: full,
          dataDir,
          exists: fs.existsSync(dataDir),
          canonical: dataDir === canonical,
        });
      }
    }
  }
  return found;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const json = argv.includes('--json');
  const fail = (code, detail) => {
    console.error(`DATADIR_FAIL ${code} ${JSON.stringify(detail ?? {})}`);
    process.exit(1);
  };
  try {
    if (argv.includes('--detect')) {
      const found = detectLegacyDataDirs();
      if (json) console.log(JSON.stringify(found, null, 2));
      else if (found.length === 0) console.log('DATADIR_OK no legacy data_dir found');
      else {
        for (const item of found) {
          console.log(`- profile ${item.profile}: ${item.dataDir}${item.exists ? '' : '（不存在）'}${item.canonical ? '（已是新家）' : ''}`);
        }
      }
      process.exit(0);
    }
    const from = valueAfter('--from');
    if (!from) {
      console.error('USAGE: node scripts/migrate-datadir.mjs --from <old-dir> [--to <dir>] [--dry-run] [--json]');
      console.error('       node scripts/migrate-datadir.mjs --detect [--json]');
      process.exit(2);
    }
    const result = migrateDataDir({
      from,
      to: valueAfter('--to') ?? null,
      dryRun: argv.includes('--dry-run'),
      logger: console,
    });
    const okStatuses = new Set(['migrated', 'already_migrated', 'dry_run']);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      const summary = `from=${result.from} to=${result.to}`;
      if (result.status === 'dry_run') console.log(`DATADIR_DRY_RUN files=${result.files.length} ${summary}`);
      else if (result.status === 'already_migrated') console.log(`DATADIR_ALREADY_MIGRATED ${summary}`);
      else console.log(`DATADIR_OK files=${result.files.length} ${summary}`);
    }
    process.exit(okStatuses.has(result.status) ? 0 : 1);
  } catch (err) {
    if (err instanceof MigrationError) fail(err.code, err.detail);
    console.error(`DATADIR_FAIL unexpected ${String(err?.message ?? err)}`);
    process.exit(1);
  }
}
