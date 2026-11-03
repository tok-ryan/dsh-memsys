import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveConfig } from '../src/config.mjs';
import { openAll, closeAll } from '../src/storage/open.mjs';
import { discoverMigrations, migrateAll, migrateDatabase } from '../src/storage/migrate.mjs';
import { appendRelation, insertRelation, seedInitialRegistry } from '../src/storage/repositories.mjs';
import { canonicalJson, payloadHash } from '../src/identity.mjs';
import { mutableClock } from './helpers/fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = (name) => path.join(ROOT, 'scripts', name);

function openPartial(clock, limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p3c2m-'));
  const config = resolveConfig({ dataDir: dir });
  const handles = openAll(config);
  const migrations = discoverMigrations();
  for (const db of ['main', 'control', 'dream']) {
    migrateDatabase(handles[db], db, migrations[db].filter((entry) => entry.version <= limits[db]), clock);
  }
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  return { dir, handles, clock, config };
}

function fullCtx() {
  const clock = mutableClock().clock;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-p3c2full-'));
  const handles = openAll(resolveConfig({ dataDir: dir }));
  migrateAll(handles, { clock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    handles.main.exec('ROLLBACK');
    throw err;
  }
  return { dir, handles, clock };
}

test('P3-C2 migration keeps old rows byte-identical and gates mixed versions', async (t) => {
  await t.test('main-008 upgrade leaves old observation/relation bytes unchanged', () => {
    const ctx = openPartial(mutableClock().clock, { main: 7, control: 4, dream: 2 });
    try {
      const at = ctx.clock.at().at;
      ctx.handles.main
        .prepare(
          `INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at)
           VALUES ('obs_old_1','obs:old:1',?, 'h', '旧观察原样', 'conversation', 'owner', '{}', 'master@2026-11-03', 0, '{}', 0.5, ?)`,
        )
        .run(at, at);
      insertRelation(ctx.handles.main, {
        id: 'rel_old_1',
        type: 'due-state',
        payload: { memoryId: 'mem_old', from: 'pending-due', to: 'shelved-due', reason: 'cap-100' },
        dedupeKey: 'due-state:mem_old:cap-100:1',
        at,
        commitSeq: 1,
        eventVersion: '1',
        payloadVersion: '1',
      });
      const before = {
        observations: ctx.handles.main.prepare('SELECT * FROM observations ORDER BY id').all().map((row) => canonicalJson(row)),
        relations: ctx.handles.main.prepare('SELECT * FROM relations ORDER BY id').all().map((row) => canonicalJson(row)),
      };
      migrateAll(ctx.handles, { clock: ctx.clock });
      const after = {
        observations: ctx.handles.main.prepare('SELECT * FROM observations ORDER BY id').all().map((row) => canonicalJson(row)),
        relations: ctx.handles.main.prepare('SELECT * FROM relations ORDER BY id').all().map((row) => canonicalJson(row)),
      };
      assert.deepEqual(after, before);
      const version = Number(ctx.handles.main.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v);
      assert.equal(version, 9);
    } finally {
      closeAll(ctx.handles);
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  await t.test('check-db closes a half-migrated trio, migrate repairs it', () => {
    const ctx = openPartial(mutableClock().clock, { main: 7, control: 3, dream: 2 });
    try {
      const closed = spawnSync(process.execPath, [CLI('check-db.mjs'), '--data-dir', ctx.dir], { encoding: 'utf8' });
      assert.notEqual(closed.status, 0);
      assert.match(closed.stdout, /VERSION_MISMATCH main=7 control=3 dream=2 business_closed=true/);
      const migrated = spawnSync(process.execPath, [CLI('migrate.mjs'), '--data-dir', ctx.dir, '--json'], { encoding: 'utf8' });
      assert.equal(migrated.status, 0, migrated.stderr);
      const repaired = spawnSync(process.execPath, [CLI('check-db.mjs'), '--data-dir', ctx.dir], { encoding: 'utf8' });
      assert.equal(repaired.status, 0, repaired.stdout);
      assert.doesNotMatch(repaired.stdout, /VERSION_MISMATCH/);
    } finally {
      closeAll(ctx.handles);
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
  });
});

test('P3-C2 backup and restore drills', async (t) => {
  await t.test('restore-check accepts a verified checkpoint and rejects tampering', () => {
    const ctx = fullCtx();
    const out = path.join(ctx.dir, 'checkpoints');
    try {
      const created = spawnSync(
        process.execPath,
        [CLI('checkpoint.mjs'), '--label', 'C2T', '--data-dir', ctx.dir, '--out', out],
        { encoding: 'utf8' },
      );
      assert.equal(created.status, 0, created.stderr);
      const restored = spawnSync(
        process.execPath,
        [CLI('restore-check.mjs'), '--data-dir', ctx.dir, '--checkpoint-root', out, '--label', 'C2T', '--out', path.join(ctx.dir, 'restores')],
        { encoding: 'utf8' },
      );
      assert.equal(restored.status, 0, restored.stdout + restored.stderr);
      assert.match(restored.stdout, /RESTORE_CHECK_OK hash=true integrity=true ledger_preserved=true/);
      const reportFile = path.join(ctx.dir, 'restores', 'report.json');
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      assert.equal(report.hash, true);
      assert.equal(report.integrity, true);

      const batch = JSON.parse(fs.readFileSync(path.join(out, report.selected_batch, 'manifest.json'), 'utf8')).databases.batch;
      const dbFile = path.join(ctx.dir, 'backup', batch, 'memsys.db');
      const original = fs.readFileSync(dbFile);
      const tampered = Buffer.from(original);
      tampered[tampered.length - 1] ^= 0xff;
      fs.writeFileSync(dbFile, tampered);
      const rejected = spawnSync(
        process.execPath,
        [CLI('restore-check.mjs'), '--data-dir', ctx.dir, '--checkpoint-root', out, '--label', 'C2T', '--out', path.join(ctx.dir, 'restores-bad')],
        { encoding: 'utf8' },
      );
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stdout, /RESTORE_CHECK_FAILED hash_mismatch/);
      fs.writeFileSync(dbFile, original);

      const manifestFile = path.join(out, report.selected_batch, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      delete manifest.databases.files;
      fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const missing = spawnSync(
        process.execPath,
        [CLI('restore-check.mjs'), '--data-dir', ctx.dir, '--checkpoint-root', out, '--label', 'C2T', '--out', path.join(ctx.dir, 'restores-missing')],
        { encoding: 'utf8' },
      );
      assert.notEqual(missing.status, 0);
      assert.match(missing.stdout, /RESTORE_CHECK_FAILED manifest_databases_missing/);
    } finally {
      closeAll(ctx.handles);
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  await t.test('restore never overwrites an existing isolated target', () => {
    const ctx = fullCtx();
    const out = path.join(ctx.dir, 'checkpoints');
    try {
      const created = spawnSync(process.execPath, [CLI('checkpoint.mjs'), '--label', 'C2R', '--data-dir', ctx.dir, '--out', out], { encoding: 'utf8' });
      assert.equal(created.status, 0, created.stderr);
      const restoreRoot = path.join(ctx.dir, 'restores');
      fs.mkdirSync(path.join(restoreRoot, 'occupied-restore'), { recursive: true });
      fs.writeFileSync(path.join(restoreRoot, 'occupied-restore', 'keep.txt'), 'x', 'utf8');
      const restored = spawnSync(
        process.execPath,
        [CLI('restore-check.mjs'), '--data-dir', ctx.dir, '--checkpoint-root', out, '--label', 'C2R', '--out', restoreRoot],
        { encoding: 'utf8' },
      );
      assert.equal(restored.status, 0, restored.stdout + restored.stderr);
      assert.ok(fs.existsSync(path.join(restoreRoot, 'occupied-restore', 'keep.txt')));
    } finally {
      closeAll(ctx.handles);
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
  });
});
