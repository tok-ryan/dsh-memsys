import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_MODULES,
  MODULE_KEYS,
  mergeModules,
  readUiConfig,
  resolveModulesDetail,
  writeUiConfig,
} from '../src/runtime/ui-config.mjs';
import { buildSummary, createSearchHandler, createSummaryHandler } from '../src/runtime/summary.mjs';
import { registerHostTools } from '../src/runtime/tools.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
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

function fakeReq({ method = 'GET', headers = {}, body = null, remoteAddress = '127.0.0.1', url = '/dsh-memsys/api/summary' } = {}) {
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

/** Records `ctx.inject` scopes; `webServer: null` means "this profile has none". */
function fakeHost({ webServer = null } = {}) {
  const scopes = [];
  const ctx = {
    inject(services, callback) {
      scopes.push([...services]);
      if (services.includes('webServer')) {
        if (!webServer) return () => {};
        callback({ webServer, effect: (fn) => fn() });
        return () => {};
      }
      callback({});
      return () => {};
    },
  };
  return { ctx, scopes };
}

test('P6/UI: modules default to all true and the summary exposes seven keys', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  assert.deepEqual(Object.keys(DEFAULT_MODULES).sort(), [...MODULE_KEYS].sort());
  assert.ok(Object.values(DEFAULT_MODULES).every((value) => value === true));

  const detail = resolveModulesDetail({ dataDir: ctx.dir, profileConfig: null, logger: silentLogger() });
  assert.equal(detail.source, 'default');
  assert.deepEqual(detail.modules, DEFAULT_MODULES);

  const summary = buildSummary(ctx.main, { dataDir: ctx.dir, modules: DEFAULT_MODULES, modulesSource: 'default' });
  assert.deepEqual(Object.keys(summary).sort(), [
    'auto_inject',
    'auto_inject_source',
    'candidates',
    'data_dir',
    'inject',
    'memories',
    'modules',
    'modules_source',
    'pending_due',
    'recent',
  ]);
  assert.deepEqual(Object.keys(summary.modules).sort(), [...MODULE_KEYS].sort());
  assert.equal(Object.values(summary.modules).filter(Boolean).length, 7);
  assert.equal(summary.modules_source, 'default');
  assert.equal(summary.auto_inject, true, 'context is on by default');

  const handler = createSummaryHandler({
    main: ctx.main,
    dataDir: ctx.dir,
    getConfig: () => ({ modules: DEFAULT_MODULES, source: 'default' }),
  });
  const res = fakeRes();
  handler(fakeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().modules_source, 'default');
  assert.equal(Object.keys(res.json().modules).length, 7);
});

test('P6/UI: POST only the changed module keeps the other six', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  let live = { modules: { ...DEFAULT_MODULES }, source: 'default' };
  const handler = createSummaryHandler({
    main: () => ctx.main,
    dataDir: ctx.dir,
    getConfig: () => live,
    onConfig: (patch) => {
      const written = writeUiConfig(ctx.dir, patch);
      live = { modules: written.modules, source: 'ui-config' };
      return { auto_inject: written.auto_inject, modules: written.modules };
    },
  });

  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ modules: { dream: false } }),
  });
  const res = fakeRes();
  handler(req, res);
  req.flush();

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.modules.dream, false);
  assert.equal(body.modules_source, 'ui-config');
  assert.equal(body.modules.context, true, 'untouched modules keep their default');
  assert.equal(body.modules.read, true);

  const stored = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'ui-config.json'), 'utf8'));
  assert.equal(stored.version, 2);
  assert.equal(stored.modules.dream, false);
  assert.equal(stored.modules.write, true);
  assert.equal(stored.auto_inject, true, 'auto_inject mirrors modules.context');
});

test('P6/UI: a v1 ui-config maps auto_inject onto modules.context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-v1-'));
  try {
    fs.writeFileSync(path.join(dir, 'ui-config.json'), JSON.stringify({ version: 1, auto_inject: false }), 'utf8');
    const logger = silentLogger();
    const stored = readUiConfig(dir, logger);
    assert.deepEqual(stored.modules, { ...DEFAULT_MODULES, context: false });
    assert.equal(stored.version, 2, 'in memory it is already v2');
    assert.equal(stored.auto_inject, false);

    const detail = resolveModulesDetail({ dataDir: dir, profileConfig: { auto_inject: true }, logger });
    assert.equal(detail.source, 'ui-config');
    assert.equal(detail.modules.context, false, 'the old switch still turns injection off');
    assert.equal(detail.modules.read, true);
    assert.equal(logger.warnings.length, 0);

    const legacy = mergeModules({ auto_inject: false, modules: { read: false } }, null);
    assert.equal(legacy.context, false);
    assert.equal(legacy.read, false);
    assert.equal(legacy.write, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P6/UI: a corrupt or unknown-version file falls back with one warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-bad-'));
  try {
    const file = path.join(dir, 'ui-config.json');
    fs.writeFileSync(file, '{ not json', 'utf8');
    const bad = silentLogger();
    assert.deepEqual(resolveModulesDetail({ dataDir: dir, profileConfig: { auto_inject: false }, logger: bad }), {
      modules: { ...DEFAULT_MODULES, context: false },
      source: 'profile',
      auto_inject: false,
    });
    assert.equal(bad.warnings.length, 1);

    fs.writeFileSync(file, JSON.stringify({ version: 99, modules: { read: false } }), 'utf8');
    const old = silentLogger();
    const detail = resolveModulesDetail({ dataDir: dir, profileConfig: null, logger: old });
    assert.equal(detail.source, 'default');
    assert.equal(detail.modules.read, true);
    assert.equal(old.warnings.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P6/UI: turning a module off shows false with source ui-config', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  let live = { modules: { ...DEFAULT_MODULES }, source: 'default' };
  const handler = createSummaryHandler({
    main: () => ctx.main,
    dataDir: ctx.dir,
    getConfig: () => live,
    onConfig: (patch) => {
      const written = writeUiConfig(ctx.dir, patch);
      live = { modules: written.modules, source: 'ui-config' };
      return { auto_inject: written.auto_inject, modules: written.modules };
    },
  });

  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ modules: { context: false } }),
  });
  const posted = fakeRes();
  handler(req, posted);
  req.flush();
  assert.equal(posted.statusCode, 200);

  const res = fakeRes();
  handler(fakeReq(), res);
  const body = res.json();
  assert.equal(body.modules.context, false);
  assert.equal(body.auto_inject, false);
  assert.equal(body.modules_source, 'ui-config');
  assert.equal(body.auto_inject_source, 'ui-config');

  const legacy = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ auto_inject: true }),
  });
  const legacyRes = fakeRes();
  handler(legacy, legacyRes);
  legacy.flush();
  assert.equal(legacyRes.json().auto_inject, true);
  assert.equal(legacyRes.json().modules.context, true, 'an old auto_inject call still maps to context');
});

test('P6/UI: counts only open candidates, pending-due memories, and truncates recent text', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  const observation = makeObservation(ctx, { text: '今天在工地把气瓶的阀门换了，顺手把记录补上。' });
  insertRow(ctx.main, 'observations', observation);

  insertRow(ctx.main, 'candidates', makeCandidate(ctx, observation, { businessKey: 'ui-cand-pending' }));
  const promotedCandidate = makeCandidate(ctx, observation, { businessKey: 'ui-cand-promoted', status: 'promoted' });
  insertRow(ctx.main, 'candidates', promotedCandidate);

  const longText = '鲸'.repeat(150);
  const dueCandidate = makeCandidate(ctx, observation, { businessKey: 'ui-cand-due', text: longText });
  insertRow(ctx.main, 'candidates', dueCandidate);
  const dueMemory = makeMemory(ctx, dueCandidate, { dueState: 'pending-due' });
  insertRow(ctx.main, 'memories', dueMemory);
  insertRow(ctx.main, 'memories', makeMemory(ctx, promotedCandidate, { businessKey: 'ui-mem-plain' }));

  const summary = buildSummary(ctx.main, { dataDir: ctx.dir });
  assert.equal(summary.memories, 2);
  assert.equal(summary.candidates, 2, 'promoted candidates are history, not "候选"');
  assert.equal(summary.pending_due, 1);
  assert.equal(summary.recent.length, 2);
  // 主人要求 120 码点（原来是 80）；这里改的是需求，不是放宽判据。
  assert.equal(Array.from(summary.recent.find((row) => row.id === dueMemory.id).text).length, 120);
});

test('P6/UI: routes reject off-loopback and cross-origin callers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-sec-'));
  const handler = createSummaryHandler({ main: null, dataDir: dir, getConfig: () => ({ modules: DEFAULT_MODULES }) });
  try {
    const denied = fakeRes();
    handler({ method: 'GET', headers: {}, socket: { remoteAddress: '8.8.8.8' } }, denied);
    assert.equal(denied.statusCode, 403);

    const cross = fakeRes();
    handler(
      { method: 'GET', headers: { origin: 'https://evil.example', host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } },
      cross,
    );
    assert.equal(cross.statusCode, 403);

    const wrongType = fakeRes();
    const badReq = fakeReq({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'modules=1' });
    handler(badReq, wrongType);
    badReq.flush();
    assert.equal(wrongType.statusCode, 415);

    const nothing = fakeRes();
    const emptyReq = fakeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    handler(emptyReq, nothing);
    emptyReq.flush();
    assert.equal(nothing.statusCode, 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P6/UI: browser half registers the panel, the sidebar row and the settings section', () => {
  const code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

  let loaded = null;
  const window = { __ModuleLoader__: { load: (mod) => { loaded = mod; } } };
  new Function('window', code)(window);
  assert.equal(loaded?.id, 'dsh-memsys', 'the module id must equal the package name');

  const React = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} };
  const plugin = loaded.factory((name) => {
    assert.equal(name, 'react');
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

  for (const key of MODULE_KEYS) {
    assert.ok(code.includes(`['${key}',`), `settings page declares a row for ${key}`);
  }
  // Every row must name when the switch takes effect; "立即生效" alone would be a lie
  // for read/dream/projects/feed, which register their tools once at boot.
  const rows = code.split('\n').filter((line) => MODULE_KEYS.some((key) => line.includes(`['${key}',`)));
  assert.equal(rows.length, MODULE_KEYS.length);
  for (const row of rows) {
    assert.match(row, /(改完立即生效|下次启动生效)/, `row must state its timing: ${row.trim()}`);
  }
  assert.equal(code.includes('下次启动生效'), true);
});

test('P6/UI: headless boot without webServer never activates the route scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-headless-'));
  const { ctx, scopes } = fakeHost({ webServer: null });

  const dispose = await apply(ctx, { data_dir: dir, auto_inject: false });
  try {
    assert.equal(typeof dispose, 'function');
    assert.ok(scopes.some((services) => services.includes('webServer')));
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
        ['exact', '/dsh-memsys/api/search'],
      ],
    );

    const ok = fakeRes();
    routes[0].handler(fakeReq({ headers: { host: '127.0.0.1:50478' } }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().modules.context, false, 'the profile auto_inject:false still wins over the default');
    assert.equal(ok.json().modules_source, 'profile');

    const cross = fakeRes();
    routes[0].handler(fakeReq({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' } }), cross);
    assert.equal(cross.statusCode, 403);
  } finally {
    dispose();
  }
});

test('P6/UI: read:false registers four tools and write:false answers module_disabled', async () => {
  const handlers = { memsys_record: async () => ({ status: 'ok' }) };
  const defineTool = (spec) => spec;

  const collect = async (modules) => {
    const names = [];
    const ctx = { tools: { register: (tool) => { names.push(tool.name); return () => {}; } } };
    await registerHostTools({ ctx, handlers, defineTool, modules });
    return names;
  };

  const all = await collect({ ...DEFAULT_MODULES });
  assert.equal(all.length, 10, 'ten tools when every module is on');

  const readOff = await collect({ ...DEFAULT_MODULES, read: false });
  assert.deepEqual(readOff.sort(), ['memsys_dream_record', 'memsys_feed', 'memsys_organize', 'memsys_record']);

  const live = { ...DEFAULT_MODULES };
  const defs = [];
  const ctx = { tools: { register: (tool) => { defs.push(tool); return () => {}; } } };
  await registerHostTools({ ctx, handlers, defineTool, modules: live });
  const record = defs.find((tool) => tool.name === 'memsys_record');
  assert.equal((await record.execute({}, {})).status, 'ok');
  live.write = false;
  const blocked = await record.execute({}, {});
  assert.equal(blocked.code, 'module_disabled', 'the call-time gate reads the live object, not a snapshot');
  assert.equal(blocked.module, 'write');
});

test('P6/UI: toggling context re-mounts the systemPrompt section immediately', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-ui-section-'));
  const routes = [];
  const sections = [];
  let disposed = 0;
  const ctx = {
    inject(services, callback) {
      if (services.includes('webServer')) {
        callback({ webServer: { register: (route) => { routes.push(route); return () => {}; } }, effect: (fn) => fn() });
        return () => {};
      }
      if (services.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section) => { sections.push(section); } } });
        return () => { disposed += 1; };
      }
      callback({});
      return () => {};
    },
  };

  const dispose = await apply(ctx, { data_dir: dir }); // no profile config: context defaults to true
  try {
    assert.equal(sections.length, 1, 'context is on by default, so the section mounts at boot');

    const post = (payload) => {
      const res = fakeRes();
      const req = fakeReq({
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
        body: JSON.stringify(payload),
      });
      routes[1].handler(req, res);
      req.flush();
      return res;
    };

    assert.equal(post({ modules: { context: false } }).statusCode, 200);
    assert.equal(sections.length, 1, 'turning context off does not mount another section');
    assert.ok(disposed >= 1, 'the mounted section was disposed');

    assert.equal(post({ modules: { context: true } }).statusCode, 200);
    assert.equal(sections.length, 2, 'turning it back on mounts a fresh section');
  } finally {
    dispose();
    // The injector keeps SQLite handles until the process exits; a locked temp
    // dir on Windows is expected and must not fail the test.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // leave it to the OS temp cleaner
    }
  }
});

test('P6/UI: the registered section text carries a real memory id, and nothing mounts when context is off', async (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  // The injector opens its own SQLite handles on the same dir; a locked temp dir
  // on Windows is expected after the test and must not fail it.
  t.after(() => {
    try {
      ctx.cleanup();
    } catch {
      // leave it to the OS temp cleaner
    }
  });

  const observation = makeObservation(ctx, { text: '主人喜欢米饭，早饭也要一碗。' });
  insertRow(ctx.main, 'observations', observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'ui-section-mem' });
  insertRow(ctx.main, 'candidates', candidate);
  const memory = makeMemory(ctx, candidate);
  insertRow(ctx.main, 'memories', memory);

  const capture = () => {
    const sections = [];
    const routes = [];
    const host = {
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
    return { host, sections, routes };
  };

  const on = capture();
  // No explicit tokenizer/H: the plugin must default them, otherwise the
  // injector only ever emits tools-only text and `context:true` is a dead shell.
  const disposeOn = await apply(on.host, { data_dir: ctx.dir, mode: 'work' });
  try {
    assert.equal(on.sections.length, 1, 'context:true mounts exactly one section');
    const registered = on.sections[0];
    assert.equal(typeof registered.text, 'function', 'the section reads its text per assemble');
    const text = registered.text();
    assert.ok(text.includes(memory.id), 'the injected text carries the real memory id');
    assert.ok(text.length > 40, 'and it is not the empty/tools-only placeholder');

    const summaryRes = fakeRes();
    on.routes[0].handler(fakeReq({ headers: { host: '127.0.0.1:50478' } }), summaryRes);
    const injectState = summaryRes.json().inject;
    assert.notEqual(injectState.level, 'unavailable', 'the default tokenizer/H keep the injector alive');
    assert.equal(injectState.reason, null);
  } finally {
    disposeOn();
  }

  const off = capture();
  const disposeOff = await apply(off.host, { data_dir: ctx.dir, modules: { context: false } });
  try {
    assert.equal(off.sections.length, 0, 'context:false mounts nothing, so nothing is injected');
  } finally {
    disposeOff();
  }
});

test('P6/UI: search route returns id-bearing items from the existing retrieval layer', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  const observation = makeObservation(ctx, { text: '香菜不要放，闻到就想吐。' });
  insertRow(ctx.main, 'observations', observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'ui-search-1', text: '不吃香菜' });
  insertRow(ctx.main, 'candidates', candidate);
  const memory = makeMemory(ctx, candidate, { businessKey: 'ui-search-mem' });
  insertRow(ctx.main, 'memories', memory);

  const handler = createSearchHandler({ main: ctx.main, clock: ctx.clock });
  const res = fakeRes();
  handler(fakeReq({ headers: { host: '127.0.0.1:50478' }, url: '/dsh-memsys/api/search?q=%E9%A6%99%E8%8F%9C&limit=5' }), res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.q, '香菜');
  assert.ok(Array.isArray(body.items) && body.items.length >= 1);
  const first = body.items[0];
  assert.equal(first.id, memory.id);
  assert.equal(typeof first.text, 'string');
  assert.equal(first.kind, 'episode');
  assert.ok(Array.from(first.text).length <= 120);
  assert.equal(typeof body.total, 'number');

  const empty = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/search?q=' }), empty);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error, 'empty_query');

  const cross = fakeRes();
  handler(
    fakeReq({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' }, url: '/dsh-memsys/api/search?q=x' }),
    cross,
  );
  assert.equal(cross.statusCode, 403);
});

test('P6/UI: the browser half renders a debounced search box and never builds HTML', () => {
  const code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  assert.ok(code.includes("placeholder: '搜记忆…'"), 'search box with the agreed placeholder');
  assert.ok(code.includes("const SEARCH = '/dsh-memsys/api/search'"));
  assert.ok(code.includes('encodeURIComponent(query)'));
  assert.ok(/setTimeout\(run, 250\)/.test(code), 'input is debounced by 250ms');
  assert.ok(code.includes("'没找到匹配的记忆'"));
  assert.ok(code.includes("'搜索不可用'"));
  // The only innerHTML-ish call is the <style> block; result rows are React text nodes.
  assert.equal((code.match(/dangerouslySetInnerHTML/g) ?? []).length, 1);
  assert.equal((code.match(/innerHTML/g) ?? []).length, 0, 'no raw innerHTML: rows are text nodes');
});
