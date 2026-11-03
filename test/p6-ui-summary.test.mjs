import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSummary,
  createSummaryHandler,
  readUiConfig,
  resolveAutoInject,
  writeUiConfig,
} from '../src/runtime/summary.mjs';
import { insertRow } from '../src/storage/repositories.mjs';
import { apply } from '../index.mjs';
import {
  createTestContext,
  makeCandidate,
  makeMemory,
  makeObservation,
  mutableClock,
} from './helpers/fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

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

function fakeReq({ method = 'GET', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
  const listeners = new Map();
  const req = {
    method,
    headers,
    url: '/dsh-memsys/api/summary',
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

/** Records `ctx.inject` scopes; `webServer: null` means "this profile has none". */
function fakeHost({ webServer = null, routes = [] } = {}) {
  const scopes = [];
  const ctx = {
    inject(services, callback) {
      scopes.push([...services]);
      if (services.includes('webServer')) {
        if (!webServer) return () => {}; // cordis never runs a scope whose service is absent
        callback({ webServer, effect: (fn) => fn() });
        return () => {};
      }
      callback({});
      return () => {};
    },
  };
  void routes;
  return { ctx, scopes };
}

test('P6/UI: summary route shape has three counts and five recent memories', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const summary = buildSummary(ctx.main, { dataDir: ctx.dir, autoInject: false });
  assert.deepEqual(
    Object.keys(summary).sort(),
    ['auto_inject', 'auto_inject_source', 'candidates', 'data_dir', 'memories', 'pending_due', 'recent'],
  );
  assert.equal(summary.memories, 0);
  assert.equal(summary.candidates, 0);
  assert.equal(summary.pending_due, 0);
  assert.equal(summary.auto_inject_source, 'default');
  assert.ok(Array.isArray(summary.recent));
  assert.equal(typeof summary.data_dir, 'string');

  const handler = createSummaryHandler({ main: ctx.main, dataDir: ctx.dir, getAutoInject: () => ({ value: false, source: 'profile' }) });
  const res = fakeRes();
  handler({ method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, url: '/dsh-memsys/api/summary' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.json().memories, 0);
  assert.equal(res.json().auto_inject_source, 'profile');

  const denied = fakeRes();
  handler({ method: 'GET', headers: {}, socket: { remoteAddress: '8.8.8.8' }, url: '/dsh-memsys/api/summary' }, denied);
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body, /forbidden/);

  const cross = fakeRes();
  handler(
    { method: 'GET', headers: { origin: 'https://evil.example', host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' }, url: '/dsh-memsys/api/summary' },
    cross,
  );
  assert.equal(cross.statusCode, 403);
});

test('P6/UI: counts only open candidates, pending-due memories, and truncates recent text', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  const observation = makeObservation(ctx, { text: '今天在工地把气瓶的阀门换了，顺手把记录补上。' });
  insertRow(ctx.main, 'observations', observation);

  const pendingCandidate = makeCandidate(ctx, observation, { businessKey: 'ui-cand-pending' });
  const promotedCandidate = makeCandidate(ctx, observation, { businessKey: 'ui-cand-promoted', status: 'promoted' });
  insertRow(ctx.main, 'candidates', pendingCandidate);
  insertRow(ctx.main, 'candidates', promotedCandidate);

  const longText = '鲸'.repeat(150);
  const dueCandidate = makeCandidate(ctx, observation, { businessKey: 'ui-cand-due', text: longText });
  insertRow(ctx.main, 'candidates', dueCandidate);
  const dueMemory = makeMemory(ctx, dueCandidate, { dueState: 'pending-due' });
  insertRow(ctx.main, 'memories', dueMemory);
  insertRow(ctx.main, 'memories', makeMemory(ctx, promotedCandidate, { businessKey: 'ui-mem-plain' }));

  const summary = buildSummary(ctx.main, { dataDir: ctx.dir, autoInject: false });
  assert.equal(summary.memories, 2);
  assert.equal(summary.candidates, 2, 'promoted candidates are history, not "候选"');
  assert.equal(summary.pending_due, 1);
  assert.equal(summary.recent.length, 2);
  assert.equal(Array.from(summary.recent.find((row) => row.id === dueMemory.id).text).length, 80);
});

test('P6/UI: ui-config.json wins over profile config, and a bad file falls back with one warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-prio-'));
  try {
    assert.deepEqual(resolveAutoInject({ dataDir: dir, profileValue: true }), { value: true, source: 'profile' });
    assert.deepEqual(resolveAutoInject({ dataDir: dir }), { value: false, source: 'default' });

    writeUiConfig(dir, false);
    assert.deepEqual(readUiConfig(dir), { auto_inject: false });
    assert.deepEqual(resolveAutoInject({ dataDir: dir, profileValue: true }), { value: false, source: 'ui-config' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ui-config.json'), 'utf8')).version, 1);

    const file = path.join(dir, 'ui-config.json');
    fs.writeFileSync(file, '{ not json', 'utf8');
    const badJson = silentLogger();
    assert.deepEqual(resolveAutoInject({ dataDir: dir, profileValue: true, logger: badJson }), { value: true, source: 'profile' });
    assert.equal(badJson.warnings.length, 1, 'a corrupt file warns once and never throws');

    fs.writeFileSync(file, JSON.stringify({ version: 99, auto_inject: true }), 'utf8');
    const badVersion = silentLogger();
    assert.deepEqual(resolveAutoInject({ dataDir: dir, profileValue: false, logger: badVersion }), { value: false, source: 'profile' });
    assert.equal(badVersion.warnings.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P6/UI: POST config persists the switch and applies it live', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  let live = { value: false, source: 'profile' };
  let applied = 0;
  const handler = createSummaryHandler({
    main: () => ctx.main,
    dataDir: ctx.dir,
    getAutoInject: () => live,
    onAutoInject: (next) => {
      writeUiConfig(ctx.dir, next);
      live = { value: next, source: 'ui-config' };
      applied += 1;
    },
  });

  const res = fakeRes();
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ auto_inject: true }),
  });
  handler(req, res);
  req.flush();

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, auto_inject: true, auto_inject_source: 'ui-config' });
  assert.equal(live.value, true, 'the running process sees the new value without a restart');
  assert.equal(applied, 1);
  assert.deepEqual(readUiConfig(ctx.dir), { auto_inject: true }, 'the switch survives a restart');
  assert.equal(fs.existsSync(path.join(ctx.dir, 'ui-config.json')), true);

  const summary = fakeRes();
  handler(fakeReq({ headers: { host: '127.0.0.1:50478' } }), summary);
  assert.equal(summary.json().auto_inject, true);
  assert.equal(summary.json().auto_inject_source, 'ui-config');

  const wrongType = fakeRes();
  const badReq = fakeReq({ method: 'POST', headers: { 'content-type': 'text/plain', host: '127.0.0.1:50478' }, body: 'auto_inject=1' });
  handler(badReq, wrongType);
  badReq.flush();
  assert.equal(wrongType.statusCode, 415);
});

test('P6/UI: browser half registers the panel, the sidebar row and the settings section', () => {
  const code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

  let loaded = null;
  const window = { __ModuleLoader__: { load: (mod) => { loaded = mod; } } };
  new Function('window', code)(window);
  assert.equal(loaded?.id, 'dsh-memsys', 'the module id must equal the package name');

  const React = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} };
  const plugin = loaded.factory((name, version) => {
    assert.equal(name, 'react');
    assert.equal(version, undefined);
    return React;
  });

  const registered = [];
  const slots = {
    inject(name, callback) {
      assert.ok(['main', 'sidebar.panellist', 'settings.section'].includes(name));
      callback();
    },
    register(spec, component) {
      registered.push({ spec, component });
      return () => {};
    },
  };
  assert.deepEqual(plugin.inject, ['slots']);
  plugin.apply({ slots });

  const byName = Object.fromEntries(registered.map((entry) => [entry.spec.name, entry]));
  assert.equal(byName.main.spec.key, 'dsh-memsys');
  assert.equal(byName['sidebar.panellist'].spec.id, 'dsh-memsys');
  assert.equal(byName['sidebar.panellist'].spec.label(), '记忆');
  assert.equal(byName['settings.section'].spec.id, 'dsh-memsys');
  assert.equal(byName['settings.section'].spec.label(), '记忆系统');
  for (const entry of registered) assert.equal(typeof entry.component, 'function');
});

test('P6/UI: headless boot without webServer never activates the route scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-headless-'));
  const { ctx, scopes } = fakeHost({ webServer: null });

  const dispose = await apply(ctx, { data_dir: dir, auto_inject: false });
  try {
    assert.equal(typeof dispose, 'function');
    assert.ok(
      scopes.some((services) => services.includes('webServer')),
      'the optional webServer scope is requested',
    );
    assert.equal(fs.existsSync(path.join(dir, 'ui-config.json')), false, 'a headless boot writes nothing');
  } finally {
    dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P6/UI: with webServer the two exact routes serve loopback and reject cross-origin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-web-'));
  const routes = [];
  const webServer = {
    register(route) {
      routes.push(route);
      return () => {};
    },
  };
  const { ctx } = fakeHost({ webServer });

  const dispose = await apply(ctx, { data_dir: dir, auto_inject: false });
  try {
    assert.deepEqual(
      routes.map((route) => [route.kind, route.path]),
      [
        ['exact', '/dsh-memsys/api/summary'],
        ['exact', '/dsh-memsys/api/config'],
      ],
    );

    const ok = fakeRes();
    routes[0].handler(fakeReq({ headers: { host: '127.0.0.1:50478' } }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().auto_inject, false);
    assert.equal(ok.json().auto_inject_source, 'profile', 'the profile patch value is the fallback rank');

    const cross = fakeRes();
    routes[0].handler(fakeReq({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' } }), cross);
    assert.equal(cross.statusCode, 403);
  } finally {
    dispose();
  }
});
