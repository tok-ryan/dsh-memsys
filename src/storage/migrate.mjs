import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../identity.mjs';
import { systemClock } from '../clock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(HERE, 'migrations');
export const SUPPORTED_DBS = ['main', 'control', 'dream'];
const FILE_PATTERN = /^(main|control|dream)-(\d{3})\.sql$/;

export class MigrationError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function discoverMigrations(dir = MIGRATIONS_DIR) {
  const out = { main: [], control: [], dream: [] };
  for (const name of fs.readdirSync(dir).sort()) {
    const match = FILE_PATTERN.exec(name);
    if (!match) continue;
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    out[match[1]].push({
      db: match[1],
      version: Number(match[2]),
      name,
      sql,
      checksum: sha256Hex(sql),
    });
  }
  for (const db of SUPPORTED_DBS) out[db].sort((a, b) => a.version - b.version);
  return out;
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
}

/**
 * Apply pending migrations for one database. Each migration runs in its own
 * IMMEDIATE transaction; a failure rolls that migration back and keeps the
 * database at its last successful version.
 */
export function migrateDatabase(db, label, migrations, clock = systemClock) {
  ensureMigrationTable(db);
  const applied = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => ({ version: Number(row.version), name: row.name, checksum: row.checksum }));
  const appliedVersions = new Set(applied.map((row) => row.version));
  const available = new Map(migrations.map((m) => [m.version, m]));

  for (const row of applied) {
    const migration = available.get(row.version);
    if (!migration) {
      throw new MigrationError('schema_from_future', { db: label, version: row.version });
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError('migration_checksum_mismatch', {
        db: label,
        version: row.version,
        appliedChecksum: row.checksum,
        fileChecksum: migration.checksum,
      });
    }
  }

  const appliedNow = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, migration.checksum, clock.at().at);
      db.exec('COMMIT');
      appliedNow.push(migration.version);
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Keep the original failure.
      }
      throw new MigrationError('migration_failed', {
        db: label,
        version: migration.version,
        name: migration.name,
        cause: err.message,
      });
    }
  }

  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get();
  return { db: label, version: Number(current.version), appliedNow };
}

/** Migrate main, control and dream in a fixed order (no cross-db atomicity claimed). */
export function migrateAll(handles, options = {}) {
  const migrations = options.migrations ?? discoverMigrations(options.dir);
  const clock = options.clock ?? systemClock;
  const results = {};
  for (const label of SUPPORTED_DBS) {
    const db = handles[label];
    if (!db) throw new MigrationError('missing_database_handle', { db: label });
    results[label] = migrateDatabase(db, label, migrations[label], clock);
  }
  return {
    versions: {
      main: results.main.version,
      control: results.control.version,
      dream: results.dream.version,
    },
    results,
  };
}
