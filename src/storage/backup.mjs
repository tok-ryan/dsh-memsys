import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase, pragmaValue } from './open.mjs';

const DB_FILES = Object.freeze([
  ['main', 'memsys.db'],
  ['control', 'control.db'],
  ['dream', 'dreams.db'],
]);

function fileHash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Consistent single-database snapshot. node:sqlite (v24) exposes no db.backup();
 * the verified fallback is VACUUM INTO, which reads a consistent snapshot and
 * includes committed WAL content. Never copy db/wal/shm files live.
 */
export function backupDatabase(db, targetFile) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.rmSync(targetFile, { force: true });
  if (typeof db.backup === 'function') {
    db.backup(targetFile);
    return { method: 'backup_api' };
  }
  const escaped = targetFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return { method: 'vacuum_into' };
}

export function backupCapability() {
  return Object.freeze({
    api: 'vacuum_into',
    backupApi: false,
    supported: true,
    note: 'node:sqlite has no db.backup(); VACUUM INTO verified consistent snapshot',
  });
}

export function verifyDatabaseFile(file) {
  const db = openDatabase(file, { busyTimeoutMs: 5000 });
  try {
    const integrity = pragmaValue(db, 'integrity_check');
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    let schemaVersion = null;
    try {
      schemaVersion = Number(
        db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v,
      );
    } catch {
      schemaVersion = null;
    }
    return {
      file,
      integrity: typeof integrity === 'string' ? integrity : JSON.stringify(integrity),
      foreignKeyViolations: foreignKeys.length,
      schemaVersion,
    };
  } finally {
    db.close();
  }
}

export function timestampLabel(clock) {
  const date = clock.now();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${String(date.getTime()).slice(-4)}`;
}

/**
 * Backup all three databases under `<dataDir>/backup/<batch>/` and write a
 * restore manifest. Callers must first enter the stop-write barrier (no
 * concurrent business writes) — the service lock is the authority for that.
 */
export function backupAll({ config, handles, clock, label }) {
  const batchLabel = label ?? timestampLabel(clock);
  const batchDir = path.join(config.dataDir, 'backup', batchLabel);
  fs.mkdirSync(batchDir, { recursive: true });

  const files = [];
  const inFlightOperationIds = [];
  let mainCommitSeq = 0;
  let controlGeneration = 0;

  for (const [name, fileName] of DB_FILES) {
    const db = handles[name];
    if (!db) throw new Error(`missing_database_handle:${name}`);
    const target = path.join(batchDir, fileName);
    const { method } = backupDatabase(db, target);
    const verified = verifyDatabaseFile(target);
    files.push({
      name,
      file: fileName,
      bytes: fs.statSync(target).size,
      sha256: fileHash(target),
      method,
      integrity: verified.integrity,
      foreignKeyViolations: verified.foreignKeyViolations,
      schemaVersion: verified.schemaVersion,
    });
  }

  try {
    const row = handles.main.prepare('SELECT COALESCE(MAX(commit_seq), 0) AS s FROM relations').get();
    mainCommitSeq = Number(row.s);
  } catch {
    mainCommitSeq = 0;
  }
  try {
    controlGeneration = Number(
      handles.control.prepare('SELECT COALESCE(MAX(generation), 0) AS g FROM operations').get().g,
    );
    const rows = handles.control
      .prepare(`SELECT object_key FROM object_streams WHERE inflight_attempt_no IS NOT NULL`)
      .all();
    for (const row of rows) inFlightOperationIds.push(row.object_key);
  } catch {
    controlGeneration = 0;
  }

  const manifest = {
    batch: batchLabel,
    created_at: clock.at().at,
    node: process.version,
    source: 'dsh-memsys batch-1',
    files,
    main_commit_seq: mainCommitSeq,
    control_generation: controlGeneration,
    in_flight_operations: inFlightOperationIds,
    dream_state: 'placeholder-only',
    empty_database_marker: files.every((f) => f.bytes < 4096),
  };
  fs.writeFileSync(path.join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { batch: batchLabel, batchDir, manifest };
}

/** Copy a verified backup batch to an isolated directory (never over the live one). */
export function restoreToIsolated(batchDir, isolatedDir) {
  fs.mkdirSync(isolatedDir, { recursive: true });
  const copied = [];
  for (const [, fileName] of DB_FILES) {
    const from = path.join(batchDir, fileName);
    const to = path.join(isolatedDir, fileName);
    fs.copyFileSync(from, to);
    copied.push({ file: to, sha256: fileHash(to) });
  }
  return { isolatedDir, copied };
}

export function readManifest(batchDir) {
  return JSON.parse(fs.readFileSync(path.join(batchDir, 'manifest.json'), 'utf8'));
}
