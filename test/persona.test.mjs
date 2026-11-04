import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PERSONA_MAX_CHARS,
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  SECTION_NAME,
  SECTION_ORDER,
} from '../src/config.mjs';
import {
  PERSONA_SAVE_MAX_CHARS,
  createPersonaHandler,
  createPersonaStore,
  parseVersionFile,
} from '../src/runtime/persona.mjs';
import { WriteError, assertOwnerRuntime } from '../src/write/authority.mjs';
import { apply } from '../index.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OWNER = Object.freeze({ role: 'owner', channel: 'settings-page' });

function tempDir(prefix = 'memsys-persona-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeVersion(dir, version, text) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `v${version}.md`), text, 'utf8');
}

/** A packaged-seed stand-in so tests never read the real repo seed. */
function seedPack(text = '# 出厂 v1\n') {
  const dir = tempDir('memsys-persona-pack-');
  writeVersion(dir, 1, text);
  return dir;
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(chunk) {
      this.body += chunk ?? '';
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function fakeReq({
  method = 'GET',
  headers = {},
  body = null,
  remoteAddress = '127.0.0.1',
  url = '/dsh-memsys/api/persona',
} = {}) {
  const listeners = new Map();
  const req = {
    method,
    headers,
    url,
    socket: { remoteAddress },
    on(event, handler) {
      listeners.set(event, handler);
      return req;
    },
    flush() {
      if (body !== null) listeners.get('data')?.(body);
      listeners.get('end')?.();
    },
  };
  return req;
}

function silentLogger() {
  const warnings = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

function post(handler, payload, extraHeaders = {}) {
  const res = fakeRes();
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478', ...extraHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  handler(req, res);
  req.flush();
  return res;
}

/** Records systemPrompt sections in assembly order plus the web routes. */
function fakeHost() {
  const sections = [];
  const routes = [];
  const ctx = {
    inject(services, callback) {
      if (services.includes('webServer')) {
        callback({ webServer: { register: (route) => { routes.push(route); return () => {}; } }, effect: (fn) => fn() });
        return () => {};
      }
      if (services.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section) => { sections.push(section); } } });
        return () => {};
      }
      callback({});
      return () => {};
    },
  };
  return { ctx, sections, routes };
}

function cleanup(...dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a SQLite handle may still own the temp dir on Windows; let the OS clean it
    }
  }
}

test('PERSONA: version files parse by numeric version, not by name or mtime', (t) => {
  const pack = seedPack();
  const data = tempDir();
  t.after(() => cleanup(pack, data));

  writeVersion(path.join(data, 'persona'), 2, 'v2 正文');
  writeVersion(path.join(data, 'persona'), 10, 'v10 正文');
  fs.writeFileSync(path.join(data, 'persona', 'README.md'), '不是版本', 'utf8');
  fs.writeFileSync(path.join(data, 'persona', 'v3.txt'), '扩展名不对', 'utf8');

  assert.equal(parseVersionFile('v12.md'), 12);
  assert.equal(parseVersionFile('README.md'), null);
  assert.equal(parseVersionFile('v2.md.bak'), null);

  const store = createPersonaStore({ dataDir: data, packagedDir: pack });
  assert.deepEqual(store.versions().map((item) => item.version), [10, 2, 1]);
  assert.deepEqual(store.versions().map((item) => item.source), ['data', 'data', 'packaged']);
  assert.equal(store.current().version, 10);
  assert.equal(store.current().text, 'v10 正文');
  assert.equal(store.readVersion(1).text, '# 出厂 v1\n');
  assert.equal(store.readVersion(99), null);
});

test('PERSONA: the highest version wins even when the packaged seed is newer in mtime', (t) => {
  const pack = tempDir();
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  writeVersion(pack, 3, 'seed v3');
  writeVersion(path.join(data, 'persona'), 2, 'owner v2');
  const store = createPersonaStore({ dataDir: data, packagedDir: pack });
  assert.equal(store.current().version, 3);
  assert.equal(store.current().source, 'packaged');
});

test('PERSONA: owner saves append v(max+1) and never rewrite an old version', (t) => {
  const pack = seedPack();
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  const store = createPersonaStore({ dataDir: data, packagedDir: pack });

  const first = store.save({ text: '第一版主人人格', caller: OWNER });
  assert.equal(first.version, 2, 'the packaged v1 seed is step one, so the first owner save is v2');
  const fileV2 = path.join(data, 'persona', 'v2.md');
  assert.equal(fs.readFileSync(fileV2, 'utf8'), '第一版主人人格\n');
  assert.equal(store.current().version, 2);
  assert.equal(store.current().source, 'data');

  const second = store.save({ text: '第二版', caller: OWNER });
  assert.equal(second.version, 3);
  assert.equal(fs.readFileSync(fileV2, 'utf8'), '第一版主人人格\n', 'the old version is untouched');
  assert.equal(fs.readFileSync(path.join(pack, 'v1.md'), 'utf8'), '# 出厂 v1\n', 'the packaged seed stays read-only');
  assert.deepEqual(store.versions().map((item) => item.version), [3, 2, 1]);
});

test('PERSONA: non-owner writes are rejected and nothing lands on disk', (t) => {
  const pack = seedPack();
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  const store = createPersonaStore({ dataDir: data, packagedDir: pack });

  for (const role of ['daily', 'dream', 'model', 'master-ish']) {
    assert.throws(
      () => store.save({ text: '偷写', caller: { role } }),
      (err) => err instanceof WriteError && err.code === 'invalid_role',
      `role ${role} must be rejected`,
    );
  }
  assert.throws(() => store.save({ text: '偷写', caller: null }), (err) => err instanceof WriteError && err.code === 'invalid_runtime');
  assert.throws(() => store.save({ text: '偷写' }), (err) => err instanceof WriteError && err.code === 'invalid_runtime');
  assert.equal(fs.existsSync(path.join(data, 'persona')), false, 'a rejected write creates no persona directory');
  assert.equal(store.versions().length, 1, 'only the packaged seed exists');

  assert.equal(assertOwnerRuntime(OWNER), OWNER);
  assert.throws(() => assertOwnerRuntime({ role: 'daily' }), /invalid_role/);
  assert.throws(() => assertOwnerRuntime('owner'), /invalid_runtime/);
});

test('PERSONA: save validates the text before writing a version', (t) => {
  const pack = seedPack();
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  const store = createPersonaStore({ dataDir: data, packagedDir: pack });

  assert.throws(() => store.save({ text: '   \n', caller: OWNER }), (err) => err.code === 'validation_error');
  assert.throws(() => store.save({ text: 42, caller: OWNER }), (err) => err.code === 'validation_error');
  assert.throws(
    () => store.save({ text: 'x'.repeat(PERSONA_SAVE_MAX_CHARS + 1), caller: OWNER }),
    (err) => err.code === 'validation_error' && err.detail?.reason === 'too_long',
  );
  assert.equal(store.versions().length, 1);
});

test('PERSONA: the injected text is capped with an explicit truncation marker', (t) => {
  const pack = seedPack('# 出厂 v1\n这一段足够长，超过五个字的上限。\n');
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  const store = createPersonaStore({ dataDir: data, packagedDir: pack, maxChars: 5 });
  const text = store.sectionText();
  assert.ok(text.startsWith('# 出厂'));
  assert.ok(text.includes('已截断'));
  assert.ok(text.includes('v1'));

  const unbounded = createPersonaStore({ dataDir: data, packagedDir: pack });
  assert.equal(unbounded.sectionText(), '# 出厂 v1\n这一段足够长，超过五个字的上限。\n');
  assert.ok(PERSONA_MAX_CHARS >= 3000);
});

test('PERSONA: the settings route reads, appends, and rejects every non-owner path', (t) => {
  const pack = seedPack();
  const data = tempDir();
  t.after(() => cleanup(pack, data));
  const store = createPersonaStore({ dataDir: data, packagedDir: pack });
  const handler = createPersonaHandler({ store, logger: silentLogger() });

  const current = fakeRes();
  handler(fakeReq(), current);
  assert.equal(current.statusCode, 200);
  assert.deepEqual(current.json().versions.map((item) => item.version), [1]);
  assert.equal(current.json().text, '# 出厂 v1\n');

  const versioned = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/persona?version=1' }), versioned);
  assert.equal(versioned.statusCode, 200);
  assert.equal(versioned.json().text, '# 出厂 v1\n');

  const saved = post(handler, { text: '主人写的新人格' });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().version, 2);
  assert.equal(store.current().version, 2);

  const cross = fakeRes();
  handler(fakeReq({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' } }), cross);
  assert.equal(cross.statusCode, 403);

  const remote = fakeRes();
  handler(fakeReq({ remoteAddress: '10.1.2.3' }), remote);
  assert.equal(remote.statusCode, 403);

  const smuggled = post(handler, { text: 'x', role: 'owner' });
  assert.equal(smuggled.statusCode, 400);
  assert.equal(smuggled.json().error, 'unknown_field');
  assert.deepEqual(smuggled.json().fields, ['role']);

  const notJson = post(handler, 'text', { 'content-type': 'text/plain' });
  assert.equal(notJson.statusCode, 415);

  // The same handler with a host-supplied non-owner caller must answer 403.
  const strict = createPersonaHandler({
    store,
    logger: silentLogger(),
    resolveCaller: () => ({ role: 'daily' }),
  });
  const refused = post(strict, { text: '模型想改人格' });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'invalid_role');
  assert.equal(store.current().version, 2, 'the refused write changed nothing');
});

test('PERSONA: section order is persona 400 before memory 500, and the master switch wins', async (t) => {
  const dir = tempDir('memsys-persona-apply-');
  const host = fakeHost();
  const dispose = await apply(host.ctx, { data_dir: dir });
  try {
    assert.deepEqual(host.sections.map((section) => [section.name, section.order]), [
      [PERSONA_SECTION_NAME, PERSONA_SECTION_ORDER],
      [SECTION_NAME, SECTION_ORDER],
    ]);
    assert.ok(PERSONA_SECTION_ORDER < SECTION_ORDER);
    const personaSection = host.sections[0];
    assert.equal(typeof personaSection.text, 'function', 'the persona text is re-read per assemble');
    assert.ok(personaSection.text().length > 0, 'the packaged seed reaches the section');

    const personaRoute = host.routes.find((route) => route.path === '/dsh-memsys/api/persona');
    assert.ok(personaRoute, 'persona route registered');
    const save = post(personaRoute.handler, { text: '主人写的人格：多短句，先给结论。' });
    assert.equal(save.statusCode, 200);
    assert.equal(save.json().version, 2);
    assert.ok(personaSection.text().includes('先给结论'), 'a save is visible to the next assembly');
  } finally {
    dispose();
    cleanup(dir);
  }

  const offHost = fakeHost();
  const disposeOff = await apply(offHost.ctx, { data_dir: dir, modules: { context: false } });
  try {
    assert.equal(offHost.sections.length, 0, 'context:false mounts neither section');
  } finally {
    disposeOff();
  }

  const personaOffHost = fakeHost();
  const disposePersonaOff = await apply(personaOffHost.ctx, { data_dir: dir, persona_section: false });
  try {
    assert.deepEqual(personaOffHost.sections.map((section) => section.name), [SECTION_NAME]);
  } finally {
    disposePersonaOff();
  }
});

test('PERSONA: the package ships a generic v1 seed and no private persona', () => {
  const seedFile = path.join(ROOT, 'persona', 'v1.md');
  assert.ok(fs.existsSync(seedFile), 'persona/v1.md exists in the package');
  const seed = fs.readFileSync(seedFile, 'utf8');
  assert.ok(seed.length > 0);
  assert.ok(Array.from(seed).length <= PERSONA_MAX_CHARS, 'the seed fits inside one injection');
  assert.equal(seed.includes('鲸鱼娘'), false, 'the public seed must not carry the private persona');
});
