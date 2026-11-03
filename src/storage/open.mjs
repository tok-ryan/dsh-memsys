import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, ensureDataDirs } from '../config.mjs';

/**
 * Open one SQLite database with the batch-1 connection profile:
 * WAL, foreign keys on, synchronous=FULL and a bounded busy timeout.
 */
export function openDatabase(file, options = {}) {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs)}`);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  return db;
}

export function openAll(configOrOverrides = {}) {
  const config = configOrOverrides.dbPaths ? configOrOverrides : resolveConfig(configOrOverrides);
  ensureDataDirs(config);
  return {
    config,
    main: openDatabase(config.dbPaths.main),
    control: openDatabase(config.dbPaths.control),
    dream: openDatabase(config.dbPaths.dream),
  };
}

export function closeAll(handles) {
  for (const key of ['dream', 'control', 'main']) {
    try {
      handles?.[key]?.close();
    } catch {
      // Closing an already-closed handle must not mask the caller's result.
    }
  }
}

export function pragmaValue(db, name) {
  const row = db.prepare(`PRAGMA ${name}`).get();
  if (!row) return null;
  const values = Object.values(row);
  return values.length === 1 ? values[0] : row;
}

/** IMMEDIATE write transaction: takes the write lock up front. */
export function withImmediate(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A rollback failure must not replace the original error.
    }
    throw err;
  }
}

/** Nested transaction unit; SQLite SAVEPOINT semantics. */
export function withSavepoint(db, name, fn) {
  const safeName = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  db.exec(`SAVEPOINT ${safeName}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${safeName}`);
    return result;
  } catch (err) {
    try {
      db.exec(`ROLLBACK TO ${safeName}`);
      db.exec(`RELEASE ${safeName}`);
    } catch {
      // Preserve the original error.
    }
    throw err;
  }
}

/** Read transaction that freezes the main-database revision. */
export function withReadSnapshot(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn({ revision: currentRevision(db) });
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw err;
  }
}

/** Main-database revision: highest commit_seq in the relation ledger. */
export function currentRevision(db) {
  const row = db.prepare('SELECT COALESCE(MAX(commit_seq), 0) AS rev FROM relations').get();
  return Number(row.rev ?? 0);
}

export function tableExists(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
    .get(name);
  return Boolean(row);
}

export function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}
