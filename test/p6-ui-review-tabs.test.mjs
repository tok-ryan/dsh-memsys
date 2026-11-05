import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createReviewHandler } from '../src/runtime/review-ui.mjs';
import { insertRow } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeObservation, mutableClock } from './helpers/fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value; },
    end(chunk) { this.body += chunk ?? ''; },
    json() { return JSON.parse(this.body); },
  };
}

function fakeReq({ method = 'GET', headers = {}, body = null, remoteAddress = '127.0.0.1', url = '/dsh-memsys/api/review' } = {}) {
  const listeners = new Map();
  const req = {
    method,
    headers,
    url,
    socket: { remoteAddress },
    on(event, handler) { listeners.set(event, handler); return req; },
    flush() {
      if (body !== null) listeners.get('data')?.(body);
      listeners.get('end')?.();
    },
  };
  return req;
}

function seed(ctx, text) {
  const observation = makeObservation(ctx, { text });
  insertRow(ctx.main, 'observations', observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'rev-' + text, text });
  insertRow(ctx.main, 'candidates', candidate);
  // The review list reads the queue, not the candidate table alone.
  const at = ctx.clock.at().at;
  insertRow(ctx.main, 'review_queue', {
    id: 'rq_' + candidate.id,
    object_kind: 'candidate',
    object_id: candidate.id,
    review_policy: 'candidate-v1',
    policy_revision: '1',
    deadline_at: null,
    created_input_seq: 1,
    status: 'open',
    close_reason: null,
    created_at: at,
    updated_at: at,
  });
  return candidate;
}

test('P6/UI: review list returns candidates with the data the tabs render', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  seed(ctx, '主人不吃香菜');

  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  const res = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/review?kind=candidate', headers: { host: '127.0.0.1:50478' } }), res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.kind, 'candidate');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].text, '主人不吃香菜');
  assert.equal(typeof body.items[0].base_revision, 'string');
  assert.deepEqual(body.items[0].actions, ['promote', 'reject']);
});

test('P6/UI: empty candidate/pending/dream lists answer with an empty set, not an error', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock });
  for (const kind of ['candidate', 'pending', 'dream']) {
    const res = fakeRes();
    handler(fakeReq({ url: '/dsh-memsys/api/review?kind=' + kind, headers: { host: '127.0.0.1:50478' } }), res);
    assert.equal(res.statusCode, 200, kind);
    assert.deepEqual(res.json().items, [], kind);
  }
});

test('P6/UI: an owner promote succeeds and stays idempotent on a repeat click', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = seed(ctx, '一条待审候选');
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock });

  const post = () => {
    const req = fakeReq({
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
      body: JSON.stringify({ kind: 'candidate', id: candidate.id, action: 'promote', baseRevision: candidate.payload_hash }),
    });
    const res = fakeRes();
    handler(req, res);
    req.flush();
    return res;
  };

  const first = post();
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().ok, true);

  const second = post();
  assert.equal(second.statusCode, 200, 'a repeat click is idempotent, not an error');
  assert.equal(second.json().result.replayed, true);
});

test('P6/UI: review routes keep the same gate (cross-origin 403, empty action 400)', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock });

  const cross = fakeRes();
  handler(fakeReq({ headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' } }), cross);
  assert.equal(cross.statusCode, 403);

  const empty = fakeRes();
  const req = fakeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'candidate', id: 'mem_1' }) });
  handler(req, empty);
  req.flush();
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error, 'empty_action');
});

function createHarness() {
  const store = [];
  const pending = [];
  let cursor = 0;
  let scheduled = false;
  let tree = null;
  let component = null;
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const render = () => {
    cursor = 0;
    tree = component();
    for (const effect of pending.splice(0, pending.length)) effect();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in store)) store[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = store[index];
      return [slot.value, (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        schedule();
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in store)) store[index] = { ref: { current: initial } };
      return store[index].ref;
    },
    useCallback(fn) {
      const index = cursor++;
      if (!(index in store)) store[index] = { cb: fn };
      return store[index].cb;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = store[index];
      if (previous && sameDeps(previous.deps, deps)) return;
      store[index] = { deps };
      pending.push(fn);
    },
  };
  const flush = async (rounds = 5) => {
    for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return tree;
  };
  return { React, mount: (next, props = {}) => { component = () => next(props); render(); }, flush };
}

const flat = (node) => {
  if (Array.isArray(node)) return node.flatMap((child) => flat(child));
  if (!node || typeof node !== 'object') return [];
  const out = [node];
  for (const child of node.children ?? []) out.push(...flat(child));
  return out;
};

const textOf = (node) => flat(node)
  .flatMap((entry) => (entry.children ?? []).filter((child) => typeof child === 'string'))
  .join('');

function mountShell(fetchImpl, name = 'ReviewList', props = { kind: 'candidate' }) {
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.fetch = fetchImpl;
  const window = {
    __ModuleLoader__: { load: (mod) => { window.__mod = mod; } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = window;
  new Function('window', CODE)(window);
  const harness = createHarness();
  const plugin = window.__mod.factory(() => harness.React);
  harness.mount(plugin.__test[name], props);
  return {
    harness,
    plugin,
    restore() {
      globalThis.setInterval = realSetInterval;
      delete globalThis.window;
    },
  };
}

test('P6/UI: the 候选 tab lists candidates, posts 批准 and shows the failure reason', async () => {
  const calls = [];
  const mounted = mountShell((url, options) => {
    const target = String(url);
    calls.push({ target, body: options?.body ?? null });
    if (target.includes('/api/review?')) {
      return Promise.resolve({ ok: true, json: async () => ({
        kind: 'candidate',
        items: [{ id: 'cand_1', text: '主人不吃香菜', type: 'fact', recorded_at: '2026-11-05T00:00:00.000Z', base_revision: 'hash1', actions: ['promote', 'reject'] }],
        total: 1,
      }) });
    }
    if (target.includes('/api/review')) {
      return Promise.resolve({ ok: false, status: 409, json: async () => ({
        ok: false,
        result: { ok: false, code: 'owner_candidate_action_unavailable', message: '设置页没有 owner 的批准通道' },
      }) });
    }
    if (target.includes('offset=')) return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
    return Promise.resolve({ ok: true, json: async () => ({ memories: 0, total: 0, recent_limit: 5, candidates: 1, pending_due: 0, modules: {}, inject: { level: 'full' } }) });
  });
  try {
    const list = await mounted.harness.flush(4);
    assert.ok(textOf(list).includes('主人不吃香菜'), 'the candidate text is rendered');

    const approve = flat(list).find((node) => node.type === 'button' && textOf(node) === '批准');
    assert.ok(approve, 'an approve button exists');
    approve.props.onClick();
    const after = await mounted.harness.flush(4);

    const posted = calls.find((call) => call.target === '/dsh-memsys/api/review' && call.body);
    assert.ok(posted, 'approving sends a POST');
    assert.deepEqual(JSON.parse(posted.body), { kind: 'candidate', id: 'cand_1', action: 'promote', baseRevision: 'hash1' });
    assert.ok(textOf(after).includes('没成功'), 'a failed write is shown, not swallowed');
    assert.ok(textOf(after).includes('owner'), 'the reason comes from the server');
  } finally {
    mounted.restore();
  }
});

test('P6/UI: the 候选 tab renders an empty state', async () => {
  const mounted = mountShell((url) => {
    const target = String(url);
    if (target.includes('/api/review?')) return Promise.resolve({ ok: true, json: async () => ({ kind: 'candidate', items: [], total: 0 }) });
    if (target.includes('offset=')) return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
    return Promise.resolve({ ok: true, json: async () => ({ memories: 0, total: 0, recent_limit: 5, candidates: 0, pending_due: 0, modules: {}, inject: { level: 'full' } }) });
  });
  try {
    const list = await mounted.harness.flush(4);
    assert.ok(textOf(list).includes('还没有待审候选'), 'the empty state is explicit');
  } finally {
    mounted.restore();
  }
});
