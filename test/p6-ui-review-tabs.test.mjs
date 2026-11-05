import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createReviewHandler } from '../src/runtime/review-ui.mjs';
import { handleOwnerDueCommand } from '../src/write/due-actions.mjs';
import { insertRow } from '../src/storage/repositories.mjs';
import { createTestContext, makeCandidate, makeMemory, makeObservation, mutableClock } from './helpers/fixtures.mjs';

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

function mountShell(fetchImpl, name = 'MemoryShelf', props = { tab: 'candidate' }) {
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

const REVIEW_ITEM = (kind) => kind === 'candidate'
  ? { id: 'cand_1', text: '主人不吃香菜', type: 'fact', recorded_at: '2026-11-05T00:00:00.000Z', base_revision: 'hash1' }
  : kind === 'pending'
    ? { id: 'mem_due_1', text: '周五前交报告', due_state: 'pending-due', due_at: '2026-11-06T00:00:00.000Z', revision: 2 }
    : { id: 'drm_1', text: '梦到主人在改面板', recorded_at: '2026-11-05T00:00:00.000Z', status: 'active', propositions: 3 };

function shellFetch(kind, options = {}) {
  const calls = [];
  const impl = (url, init) => {
    const target = String(url);
    calls.push({ target, body: init?.body ?? null });
    if (target.includes('/api/review?')) {
      return Promise.resolve({ ok: true, json: async () => ({ kind, items: options.items ?? [REVIEW_ITEM(kind)], total: 1 }) });
    }
    if (target.includes('/api/review')) {
      return Promise.resolve({ ok: options.postOk !== false, status: options.postOk === false ? 409 : 200, json: async () => (
        options.postOk === false
          ? { ok: false, result: { ok: false, message: '服务端说不行' } }
          : { ok: true, result: { ok: true, status: 'found' } }
      ) });
    }
    if (target.includes('offset=')) return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
    return Promise.resolve({ ok: true, json: async () => ({ memories: 1, total: 1, recent_limit: 5, candidates: 1, pending_due: 1, modules: {}, inject: { level: 'full' } }) });
  };
  return { impl, calls };
}

const ballCount = (tree) => flat(tree).filter((node) => node.props?.className === 'ms-slot' && node.props['data-kind']).length;

test('P6/UI: every tab renders the same ms-hall and one ball per row', async () => {
  for (const kind of ['candidate', 'pending', 'dream']) {
    const { impl } = shellFetch(kind);
    const mounted = mountShell(impl, 'MemoryShelf', { tab: kind });
    try {
      const tree = await mounted.harness.flush(5);
      const halls = flat(tree).filter((node) => node.props?.className === 'ms-hall');
      assert.equal(halls.length, 1, kind + ' renders the shared ms-hall');
      assert.equal(ballCount(tree), 1, kind + ' draws one ball for its one row');
    } finally {
      mounted.restore();
    }
  }
});

test('P6/UI: clicking a candidate ball opens the shared card with 批准/驳回', async () => {
  const { impl, calls } = shellFetch('candidate');
  const mounted = mountShell(impl, 'MemoryShelf', { tab: 'candidate' });
  try {
    const tree = await mounted.harness.flush(5);
    const slot = flat(tree).find((node) => node.props?.className === 'ms-slot' && typeof node.props.onClick === 'function');
    slot.props.onClick();
    const opened = await mounted.harness.flush(3);
    const card = flat(opened).find((node) => typeof node.props?.className === 'string' && node.props.className.includes('ms-card'));
    assert.ok(card, 'the shared ms-card opens');
    assert.ok(textOf(card).includes('批准') && textOf(card).includes('驳回'), 'candidate actions are in the card');

    const approve = flat(card).find((node) => node.type === 'button' && textOf(node) === '批准');
    approve.props.onClick();
    const after = await mounted.harness.flush(4);
    const posted = calls.find((call) => call.target === '/dsh-memsys/api/review' && call.body);
    assert.ok(posted, 'approve posts');
    assert.deepEqual(JSON.parse(posted.body), { kind: 'candidate', id: 'cand_1', action: 'promote', baseRevision: 'hash1' });
    assert.equal(flat(after).some((node) => typeof node.props?.className === 'string' && node.props.className.includes('ms-card')), false, 'a successful action closes the card');
  } finally {
    mounted.restore();
  }
});

test('P6/UI: pending balls offer 确认已做/搁置, dream balls offer no action', async () => {
  const pendingMount = shellFetch('pending');
  const pending = mountShell(pendingMount.impl, 'MemoryShelf', { tab: 'pending' });
  try {
    const tree = await pending.harness.flush(5);
    flat(tree).find((node) => node.props?.className === 'ms-slot').props.onClick();
    const opened = await pending.harness.flush(3);
    const card = flat(opened).find((node) => typeof node.props?.className === 'string' && node.props.className.includes('ms-card'));
    assert.ok(textOf(card).includes('确认已做') && textOf(card).includes('搁置'));
  } finally {
    pending.restore();
  }

  const dreamMount = shellFetch('dream');
  const dream = mountShell(dreamMount.impl, 'MemoryShelf', { tab: 'dream' });
  try {
    const tree = await dream.harness.flush(5);
    flat(tree).find((node) => node.props?.className === 'ms-slot').props.onClick();
    const opened = await dream.harness.flush(3);
    const card = flat(opened).find((node) => typeof node.props?.className === 'string' && node.props.className.includes('ms-card'));
    assert.ok(card, 'dream ball still opens the card');
    const buttons = flat(card).filter((node) => node.type === 'button');
    assert.equal(buttons.length, 0, 'the dream card carries no action buttons');
  } finally {
    dream.restore();
  }
});

test('P6/UI: an empty tab keeps the hall and shows the line', async () => {
  const { impl } = shellFetch('candidate', { items: [] });
  const mounted = mountShell(impl, 'MemoryShelf', { tab: 'candidate' });
  try {
    const tree = await mounted.harness.flush(5);
    assert.equal(flat(tree).filter((node) => node.props?.className === 'ms-hall').length, 1, 'the shelf is still drawn');
    const hint = flat(tree).find((node) => node.props?.className === 'ms-hint');
    assert.ok(hint && textOf(hint).includes('这一格里还没有东西'));
  } finally {
    mounted.restore();
  }
});

test('P6/UI: real host shape (thunk handles) serves all three lists from a real DB', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  seed(ctx, '主人不吃香菜');

  // pending-due: a memory plus its due_queue row
  const observation = makeObservation(ctx, { text: '周五前交报告', messageSeq: 77 });
  insertRow(ctx.main, 'observations', observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'rev-due', text: '周五前交报告' });
  insertRow(ctx.main, 'candidates', candidate);
  const dueMemory = makeMemory(ctx, candidate, { businessKey: 'rev-due-mem', dueState: 'pending-due' });
  insertRow(ctx.main, 'memories', dueMemory);
  const at = ctx.clock.at().at;
  insertRow(ctx.main, 'due_queue', {
    memory_id: dueMemory.id,
    due_state: 'pending-due',
    enqueued_seq: 1,
    enqueued_at: at,
    opened_at: null,
    deadline_at: null,
    revision: 3,
    reason: 'fixture',
  });

  // one dream in the dream store
  insertRow(ctx.dream, 'dreams', {
    id: 'drm_fixture_1',
    idempotency_key: 'drm-fixture-1',
    at,
    payload_hash: 'hash-fixture-1',
    linked_ids: '[]',
    basis: '白天想到的',
    idea: '梦里记得主人在改记忆面板',
    origin: 'dream:fixture',
    author_runtime: JSON.stringify({ role: 'dream', identity: 'fixture', sessionId: 'fixture', callId: 'c1' }),
    state_snapshot: '{}',
    initial_strength: 0.5,
  });

  // index.mjs passes thunks, not handles — the shape that broke 0.3.3 on the real host.
  const handler = createReviewHandler({
    main: () => ctx.main,
    control: () => ctx.control,
    dream: () => ctx.dream,
    clock: ctx.clock,
  });

  for (const kind of ['candidate', 'pending', 'dream']) {
    const res = fakeRes();
    handler(fakeReq({ url: '/dsh-memsys/api/review?kind=' + kind, headers: { host: '127.0.0.1:50478' } }), res);
    assert.equal(res.statusCode, 200, kind + ' should answer 200');
    const body = res.json();
    assert.ok(Array.isArray(body.items) && body.items.length >= 1, kind + ' should list its row');
  }
});

test('P6/UI: confirm through the thunk-shaped handler really moves the due state', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());

  const observation = makeObservation(ctx, { text: '周五前交报告', messageSeq: 91 });
  insertRow(ctx.main, 'observations', observation);
  const candidate = makeCandidate(ctx, observation, { businessKey: 'due-confirm', text: '周五前交报告' });
  insertRow(ctx.main, 'candidates', candidate);
  const memory = makeMemory(ctx, candidate, { businessKey: 'due-confirm-mem', dueState: 'pending-due' });
  insertRow(ctx.main, 'memories', memory);
  const at = ctx.clock.at().at;
  insertRow(ctx.main, 'due_queue', {
    memory_id: memory.id, due_state: 'pending-due', enqueued_seq: 1, enqueued_at: at,
    opened_at: null, deadline_at: null, revision: 0, reason: 'fixture',
  });

  // due-confirm requires an approved policy; approve it through the same owner channel.
  const approved = handleOwnerDueCommand(
    { main: ctx.main, control: ctx.control, clock: ctx.clock },
    { text: '/mem due-policy-approve due-policy-v1', inputEventId: 'ui-policy-1', ownerId: 'owner-ui' },
  );
  assert.equal(approved.ok, true, 'policy approval must succeed in the fixture');

  const handler = createReviewHandler({
    main: () => ctx.main,
    control: () => ctx.control,
    dream: () => ctx.dream,
    clock: ctx.clock,
  });

  const liveRevision = Number(ctx.main.prepare('SELECT revision FROM due_queue WHERE memory_id = ?').get(memory.id)?.revision ?? 0);
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ kind: 'pending', id: memory.id, action: 'confirm', revision: liveRevision }),
  });
  const res = fakeRes();
  handler(req, res);
  req.flush();

  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  const after = ctx.main.prepare('SELECT due_state FROM memories WHERE id = ?').get(memory.id);
  assert.notEqual(after.due_state, 'pending-due', 'the memory really left pending-due');
  assert.equal(after.due_state, 'done');
});

test('P6/UI: promote through the thunk-shaped handler really adds a memory row', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const candidate = seed(ctx, '主人爱吃米饭');
  const before = Number(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n);

  const handler = createReviewHandler({
    main: () => ctx.main,
    control: () => ctx.control,
    dream: () => ctx.dream,
    clock: ctx.clock,
  });
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify({ kind: 'candidate', id: candidate.id, action: 'promote', baseRevision: candidate.payload_hash }),
  });
  const res = fakeRes();
  handler(req, res);
  req.flush();

  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  const after = Number(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
  assert.equal(after, before + 1, 'a promoted candidate becomes a memory');
});
