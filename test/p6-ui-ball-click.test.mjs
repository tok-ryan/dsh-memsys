import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');

/** Minimal React runtime: hooks + deferred re-render; enough to mount one panel. */
function createHarness() {
  const store = [];
  const pendingEffects = [];
  let cursor = 0;
  let scheduled = false;
  let tree = null;
  let component = null;

  const sameDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  let renders = 0;
  const render = () => {
    renders += 1;
    cursor = 0;
    tree = component();
    const effects = pendingEffects.splice(0, pendingEffects.length);
    for (const effect of effects) effect();
    const flatCount = (n) => n && typeof n === "object" ? 1 + (n.children ?? []).reduce((a, c) => a + flatCount(c), 0) : 0;
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      render();
    });
  };

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
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
      pendingEffects.push(fn);
    },
  };

  const flush = async (rounds = 4) => {
    for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return tree;
  };

  return { React, mount: (next) => { component = next; render(); }, flush };
}

const flat = (node) => {
  if (Array.isArray(node)) return node.flatMap((child) => flat(child));
  if (!node || typeof node !== 'object') return [];
  const out = [node];
  for (const child of node.children ?? []) out.push(...flat(child));
  return out;
};

test('P6/UI: clicking the third ball asks for that id and shows the card above the hall', async () => {
  const memory = (index) => ({
    id: 'mem_' + index,
    text: '第' + index + '条记忆正文',
    type: 'fact',
    weight: 5,
    recorded_at: '2026-11-0' + ((index % 5) + 1) + 'T00:00:00.000Z',
  });
  const page = { items: Array.from({ length: 25 }, (_, index) => memory(index)), total: 25 };
  const calls = [];
  let resolveDetail = null;

  // The panel polls every 15s; a live interval keeps node --test awake forever.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};

  globalThis.fetch = (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/api/memory?')) {
      return new Promise((resolve) => {
        resolveDetail = () => resolve({
          ok: true,
          json: async () => ({ id: 'mem_2', text: '第三颗球的完整正文', type: 'fact', created_at: '2026-11-03T00:00:00.000Z' }),
        });
      });
    }
    const payload = target.includes('offset=')
      ? page
      : { memories: 25, total: 25, recent_limit: 5, candidates: 0, pending_due: 0, modules: {}, inject: { level: 'full', reason: null } };
    return Promise.resolve({ ok: true, json: async () => payload });
  };

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
  harness.mount(plugin.__test.MemoryPanel);
  const tree = await harness.flush(6);

  const classes = flat(tree).map((node) => node.props && node.props.className).filter(Boolean);
  const slots = flat(tree).filter((node) => node.props && node.props.className === 'ms-slot' && typeof node.props.onClick === 'function');
  assert.ok(slots.length >= 3, 'the hall renders clickable slots');

  slots[2].props.onClick();
  const afterClick = await harness.flush(2);
  const withCard = flat(afterClick);
  const card = withCard.find((node) => node.props && node.props.className === 'ms-card');
  assert.ok(card, 'a card appears immediately after the click');
  assert.equal(flat(card).map((node) => node.children.filter((child) => typeof child === 'string').join('')).join('').includes('读取中'), true,
    'the card says 读取中… before the request settles');
  assert.ok(calls.some((url) => url === '/dsh-memsys/api/memory?id=mem_2'), 'the request carries the clicked id');

  // Structure: the card is a sibling that comes BEFORE the hall.
  const rootChildren = afterClick.children.filter((child) => child && child.props);
  const cardIndex = rootChildren.findIndex((node) => node.props.className === 'ms-card');
  const hallIndex = rootChildren.findIndex((node) => node.props.className === 'ms-hall');
  assert.ok(cardIndex >= 0 && hallIndex >= 0, 'both card and hall exist');
  assert.ok(cardIndex < hallIndex, 'the card sits above the hall in the DOM order');

  resolveDetail();
  const settled = await harness.flush(3);
  const text = flat(settled).map((node) => (node.children ?? []).filter((child) => typeof child === 'string').join('')).join('');
  assert.ok(text.includes('第三颗球的完整正文'), 'the fetched text reaches the card');
  assert.ok(text.includes('再次点击收起'), 'the card tells the owner how to close it');

  globalThis.setInterval = realSetInterval;
  delete globalThis.window;
});
