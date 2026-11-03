import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  defaultDataDir,
  resolveConfig,
  resolveDataDir,
} from '../src/config.mjs';
import { resolveModulesDetail, uiConfigPath, writeUiConfig } from '../src/runtime/ui-config.mjs';
import { closeAll, openAll } from '../src/storage/open.mjs';
import {
  MIGRATION_MARKER,
  MigrationError,
  contentDigest,
  detectLegacyDataDirs,
  migrateDataDir,
} from '../scripts/migrate-datadir.mjs';

const SQLITE_BUSY = 5;

function tempDir(prefix = 'memsys-datadir-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function silentLogger() {
  return { warnings: [], warn() {}, info() {} };
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leaked SQLite handle may keep the temp dir; the OS cleans it later
    }
  }
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function sha256Of(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Seed three real memsys databases plus the switch file and a backup tree. */
function seedLegacyDir(dir) {
  const handles = openAll(resolveConfig({ dataDir: dir }));
  try {
    const text = (db, value) => {
      db.exec('CREATE TABLE IF NOT EXISTS t(text TEXT)');
      db.prepare('INSERT INTO t(text) VALUES (?)').run(value);
    };
    text(handles.main, '不吃葱。');
    text(handles.main, '喜欢米饭。');
    text(handles.control, '控制库：一次提交');
    text(handles.dream, '梦库：一条命题');
  } finally {
    closeAll(handles);
  }
  writeUiConfig(dir, { modules: { feed: false } });
  fs.mkdirSync(path.join(dir, 'backup', 'batch-1'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'backup', 'batch-1', 'manifest.json'),
    `${JSON.stringify({ ok: true, label: 'batch-1' }, null, 2)}\n`,
    'utf8',
  );
}

function snapshot(dir) {
  const files = {};
  for (const rel of walk(dir)) files[rel] = sha256Of(path.join(dir, rel));
  const content = {};
  for (const rel of Object.keys(files).filter((name) => name.endsWith('.db'))) {
    content[rel] = contentDigest(path.join(dir, rel));
  }
  return { files, content };
}

test('DATADIR: one resolver — default is ~/.dsh/memsys and ui-config follows it', (t) => {
  const env = { ...process.env };
  delete env.MEMSYS_DATA_DIR;

  assert.equal(defaultDataDir(), path.join(os.homedir(), '.dsh', 'memsys'));
  assert.equal(resolveDataDir({ env }), defaultDataDir());
  assert.equal(resolveDataDir({ dataDir: path.join(os.tmpdir(), 'explicit'), env }), path.resolve(os.tmpdir(), 'explicit'));
  assert.equal(resolveDataDir({ data_dir: path.join(os.tmpdir(), 'legacy'), env }), path.resolve(os.tmpdir(), 'legacy'));
  assert.equal(
    resolveDataDir({ env: { MEMSYS_DATA_DIR: path.join(os.tmpdir(), 'probe') } }),
    path.resolve(os.tmpdir(), 'probe'),
  );
  assert.throws(() => resolveDataDir({ dataDir: '   ', env }), /invalid_data_dir/);

  const config = resolveConfig({ dataDir: path.join(os.tmpdir(), 'cfg'), env });
  assert.equal(config.dataDir, path.resolve(os.tmpdir(), 'cfg'));
  assert.equal(config.personaDir, path.join(path.resolve(os.tmpdir(), 'cfg'), 'persona'));
  assert.equal(config.personaInjectionSection.name, PERSONA_SECTION_NAME);
  assert.equal(config.personaInjectionSection.order, PERSONA_SECTION_ORDER);
  assert.ok(PERSONA_SECTION_ORDER < 500);

  assert.equal(uiConfigPath(null), path.join(defaultDataDir(), 'ui-config.json'));

  const dir = tempDir();
  t.after(() => cleanup(dir));
  writeUiConfig(dir, { modules: { context: false } });
  assert.ok(fs.existsSync(path.join(dir, 'ui-config.json')), 'ui-config lands in the resolved data dir');
  assert.equal(resolveModulesDetail({ dataDir: dir, logger: silentLogger() }).modules.context, false);
});

test('DATADIR: migration keeps every byte, content and the legacy tree is gone', (t) => {
  const source = tempDir('memsys-legacy-');
  const target = tempDir('memsys-canonical-');
  t.after(() => cleanup(source, target));
  seedLegacyDir(source);
  const before = snapshot(source);

  const result = migrateDataDir({ from: source, to: target, logger: silentLogger() });
  assert.equal(result.status, 'migrated');
  assert.equal(fs.existsSync(source), false, 'the legacy directory is removed after a verified move');

  const after = snapshot(target);
  delete after.files[MIGRATION_MARKER];
  assert.deepEqual(after.files, before.files, 'every file is byte-identical after the move');
  assert.deepEqual(after.content, before.content, 'every database table row is identical after the move');

  const db = new DatabaseSync(path.join(target, 'memsys.db'));
  try {
    assert.deepEqual(db.prepare('SELECT text FROM t ORDER BY rowid').all().map((row) => row.text), ['不吃葱。', '喜欢米饭。']);
  } finally {
    db.close();
  }
  const uiConfig = JSON.parse(fs.readFileSync(path.join(target, 'ui-config.json'), 'utf8'));
  assert.equal(uiConfig.modules.feed, false);

  const marker = JSON.parse(fs.readFileSync(path.join(target, MIGRATION_MARKER), 'utf8'));
  assert.equal(marker.schema, 'dsh-memsys-datadir-migration');
  assert.equal(marker.from, path.resolve(source));
  assert.deepEqual(Object.keys(marker.files).sort(), Object.keys(before.files).sort());
});

test('DATADIR: rerunning migration is a no-op and touches no file', (t) => {
  const source = tempDir('memsys-legacy-again-');
  const target = tempDir('memsys-canonical-again-');
  t.after(() => cleanup(source, target));
  seedLegacyDir(source);
  const first = migrateDataDir({ from: source, to: target, logger: silentLogger() });
  assert.equal(first.status, 'migrated');
  const moved = snapshot(target);

  const second = migrateDataDir({ from: source, to: target, logger: silentLogger() });
  assert.equal(second.status, 'already_migrated');
  const afterSecond = snapshot(target);
  assert.deepEqual(afterSecond.files, moved.files, 'the second run changes nothing');
  assert.deepEqual(afterSecond.content, moved.content);
  assert.equal(second.from, path.resolve(source), 'the marker remembers the old directory');
});

test('DATADIR: a live WAL writer blocks the move and the source survives', (t) => {
  const source = tempDir('memsys-legacy-locked-');
  const target = tempDir('memsys-canonical-locked-');
  t.after(() => cleanup(source, target));
  seedLegacyDir(source);
  const before = snapshot(source);

  const holder = new DatabaseSync(path.join(source, 'memsys.db'));
  holder.exec('PRAGMA busy_timeout = 0');
  holder.exec('BEGIN IMMEDIATE');
  holder.prepare('INSERT INTO t(text) VALUES (?)').run('还没提交的写入');
  try {
    assert.throws(
      () => migrateDataDir({ from: source, to: target, logger: silentLogger() }),
      (err) => {
        assert.ok(err instanceof MigrationError, 'a typed migration error, not a silent failure');
        assert.equal(err.code, 'datadir_locked');
        assert.ok(String(err.detail?.reason ?? err.message).length > 0, 'the error explains why');
        return true;
      },
    );
    assert.equal(fs.existsSync(path.join(target, MIGRATION_MARKER)), false, 'no marker was written');
    assert.equal(fs.existsSync(path.join(source, 'memsys.db')), true, 'the source database is still in place');
  } finally {
    holder.exec('ROLLBACK');
    holder.close();
  }

  const afterFailure = snapshot(source);
  assert.deepEqual(afterFailure.content, before.content, 'the locked source is untouched');

  const after = migrateDataDir({ from: source, to: target, logger: silentLogger() });
  assert.equal(after.status, 'migrated', 'once the writer is gone the same command succeeds');
});

test('DATADIR: refusing an unsafe target and the dry run never writes', (t) => {
  const source = tempDir('memsys-legacy-target-');
  t.after(() => cleanup(source));
  seedLegacyDir(source);

  const occupied = tempDir('memsys-occupied-');
  t.after(() => cleanup(occupied));
  fs.writeFileSync(path.join(occupied, 'keep.txt'), 'not ours', 'utf8');
  assert.throws(
    () => migrateDataDir({ from: source, to: occupied, logger: silentLogger() }),
    (err) => err instanceof MigrationError && err.code === 'target_not_empty',
  );
  assert.equal(fs.existsSync(path.join(source, 'memsys.db')), true, 'the refused target leaves the source in place');

  const dryTarget = path.join(tempDir('memsys-dry-parent-'), 'canonical');
  assert.equal(fs.existsSync(dryTarget), false);
  const dry = migrateDataDir({ from: source, to: dryTarget, dryRun: true, logger: silentLogger() });
  assert.equal(dry.status, 'dry_run');
  assert.ok(dry.files.includes('memsys.db'));
  assert.equal(fs.existsSync(dryTarget), false, 'a dry run creates no target directory');
  assert.equal(fs.existsSync(path.join(source, 'memsys.db')), true, 'a dry run moves nothing');
});

test('DATADIR: legacy data_dir values are discoverable in profile patches (read-only)', (t) => {
  const profiles = tempDir('memsys-profiles-');
  t.after(() => cleanup(profiles));
  fs.mkdirSync(path.join(profiles, 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(profiles, 'demo', 'cordis.patch.yml'),
    '- id: memsys\n  config:\n    data_dir: C:/Users/someone/Desktop/ai/memsys-gui-data\n    auto_inject: false\n',
    'utf8',
  );
  fs.mkdirSync(path.join(profiles, 'clean'), { recursive: true });
  fs.writeFileSync(path.join(profiles, 'clean', 'cordis.patch.yml'), '[]\n', 'utf8');

  const found = detectLegacyDataDirs({ profilesDir: profiles });
  assert.equal(found.length, 1);
  assert.equal(found[0].profile, 'demo');
  assert.equal(found[0].dataDir, path.resolve('C:/Users/someone/Desktop/ai/memsys-gui-data'));
  assert.equal(found[0].canonical, false);
});
