import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_MODULES } from '../src/runtime/ui-config.mjs';
import { buildSummaryPage, createSummaryHandler, parsePageParams } from '../src/runtime/summary.mjs';
import { insertRow } from '../src/storage/repositories.mjs';
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

function fakeReq({ method = 'GET', headers = {}, url = '/dsh-memsys/api/summary', remoteAddress = '127.0.0.1' } = {}) {
  return { method, headers, url, socket: { remoteAddress } };
}

/** A migrated temp workspace with `count` memories, oldest first. */
function seedHall(t, count, { text = '记忆走廊测试用观察。' } = {}) {
  const clock = mutableClock('2026-11-03T00:00:00.000Z');
  const ctx = createTestContext({ clock: clock.clock });
  t.after(() => ctx.cleanup());
  const observation = makeObservation(ctx, { text });
  insertRow(ctx.main, 'observations', observation);
  const memories = [];
  for (let index = 0; index < count; index += 1) {
    clock.advance(60_000);
    // memories.promoted_from is unique, so every memory needs its own candidate
    const candidate = makeCandidate(ctx, observation, { businessKey: `hall-candidate-${index}` });
    insertRow(ctx.main, 'candidates', candidate);
    const memory = makeMemory(ctx, candidate, { businessKey: `hall-memory-${index}` });
    insertRow(ctx.main, 'memories', memory);
    memories.push(memory);
  }
  return { ctx, memories };
}

test('P6/hall: pages hold 25 rows, newest first, and never overlap', (t) => {
  const { ctx, memories } = seedHall(t, 60);
  const newest = memories[memories.length - 1];

  const page0 = buildSummaryPage(ctx.main, { offset: 0, limit: 25 });
  assert.equal(page0.total, 60);
  assert.equal(page0.offset, 0);
  assert.equal(page0.limit, 25);
  assert.equal(page0.items.length, 25, 'wall one is full');
  assert.equal(page0.has_more, true);
  assert.equal(page0.items[0].id, newest.id, 'index 0 of the first wall is the newest memory');
  assert.equal(page0.items[24].id, memories[60 - 1 - 24].id, 'the 25th ball closes the wall, then the next wall starts');
  // (recorded_at, id) is unique, so consecutive pages cannot repeat a row
  for (const item of page0.items) {
    for (const key of ['id', 'text', 'type', 'weight', 'recorded_at']) {
      assert.equal(key in item, true, `page item keeps ${key}`);
    }
  }

  const page1 = buildSummaryPage(ctx.main, { offset: 25, limit: 25 });
  assert.equal(page1.items.length, 25);
  assert.equal(page1.items[0].id, memories[34].id);
  assert.equal(page1.has_more, true);

  const page2 = buildSummaryPage(ctx.main, { offset: 50, limit: 25 });
  assert.equal(page2.items.length, 10);
  assert.equal(page2.has_more, false);
  assert.equal(page2.items[9].id, memories[0].id, 'the oldest memory closes the last page');

  const ids = new Set([...page0.items, ...page1.items, ...page2.items].map((item) => item.id));
  assert.equal(ids.size, 60, 'three pages together are exactly the 60 memories');
});

test('P6/hall: 25 memories fill exactly one wall, 26 open a second', (t) => {
  const exact = seedHall(t, 25);
  const first = buildSummaryPage(exact.ctx.main, { offset: 0, limit: 25 });
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 25);
  assert.equal(first.has_more, false, 'a full 25-row wall has no side face yet');
  const beyond = buildSummaryPage(exact.ctx.main, { offset: 25, limit: 25 });
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.has_more, false);

  const more = seedHall(t, 26);
  const page0 = buildSummaryPage(more.ctx.main, { offset: 0, limit: 25 });
  assert.equal(page0.has_more, true, 'the 26th memory opens the next wall');
  const page1 = buildSummaryPage(more.ctx.main, { offset: 25, limit: 25 });
  assert.equal(page1.items.length, 1);
  assert.equal(page1.has_more, false);
});

test('P6/hall: page text is still capped at 120 codepoints', (t) => {
  const { ctx } = seedHall(t, 3, { text: '廊'.repeat(200) });
  const page = buildSummaryPage(ctx.main, { offset: 0, limit: 25 });
  assert.equal(page.items.length, 3);
  for (const item of page.items) assert.equal(Array.from(item.text).length, 120);
});

test('P6/hall: paging params are strict and the route keeps its loopback gate', (t) => {
  assert.deepEqual(parsePageParams('/dsh-memsys/api/summary'), { paged: false });
  assert.deepEqual(parsePageParams('/dsh-memsys/api/summary?offset=0&limit=25'), { paged: true, offset: 0, limit: 25 });
  assert.deepEqual(parsePageParams('/dsh-memsys/api/summary?limit=5'), { paged: true, offset: 0, limit: 5 });

  const { ctx } = seedHall(t, 30);
  const handler = createSummaryHandler({
    main: ctx.main,
    dataDir: ctx.dir,
    getConfig: () => ({ modules: DEFAULT_MODULES, source: 'default' }),
  });

  const pageRes = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/summary?offset=0&limit=25', headers: { host: '127.0.0.1:52977' } }), pageRes);
  assert.equal(pageRes.statusCode, 200);
  assert.equal(pageRes.json().total, 30);
  assert.equal(pageRes.json().items.length, 25);
  assert.equal(pageRes.json().has_more, true);

  const plainRes = fakeRes();
  handler(fakeReq({ headers: { host: '127.0.0.1:52977' } }), plainRes);
  assert.equal(plainRes.statusCode, 200);
  assert.equal(Array.isArray(plainRes.json().recent), true, 'a plain GET still returns the whole summary');
  assert.equal('items' in plainRes.json(), false);

  for (const [query, error] of [
    ['offset=-1', 'invalid_offset'],
    ['offset=1.5', 'invalid_offset'],
    ['offset=abc', 'invalid_offset'],
    ['limit=0', 'invalid_limit'],
    ['limit=abc', 'invalid_limit'],
    ['limit=101', 'invalid_limit'],
  ]) {
    const res = fakeRes();
    handler(fakeReq({ url: '/dsh-memsys/api/summary?' + query }), res);
    assert.equal(res.statusCode, 400, query);
    assert.equal(res.json().error, error, query);
  }

  const cross = fakeRes();
  handler(fakeReq({
    url: '/dsh-memsys/api/summary?offset=0&limit=25',
    headers: { origin: 'https://evil.example', host: '127.0.0.1:52977' },
  }), cross);
  assert.equal(cross.statusCode, 403);

  const remote = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/summary?offset=0&limit=25', remoteAddress: '8.8.8.8' }), remote);
  assert.equal(remote.statusCode, 403);
});

function loadBrowserHalf() {
  const code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  let loaded = null;
  const window = { __ModuleLoader__: { load: (mod) => { loaded = mod; } } };
  new Function('window', code)(window);
  const React = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
  };
  return { code, plugin: loaded.factory((name) => { assert.equal(name, 'react'); return React; }) };
}

test('P6/hall: the wall model keeps 25 balls per wall and index 0 newest', () => {
  const { plugin } = loadBrowserHalf();
  const { hallWallCount, hallHasNext, hallCells, hallIndex, hallMetrics } = plugin.__test;

  assert.equal(hallWallCount(0), 1, 'even an empty hall has one wall');
  assert.equal(hallWallCount(1), 1);
  assert.equal(hallWallCount(25), 1);
  assert.equal(hallWallCount(26), 2);
  assert.equal(hallWallCount(50), 2);
  assert.equal(hallWallCount(51), 3);

  assert.equal(hallHasNext(0, 25), false, 'a wall of exactly 25 draws no side face');
  assert.equal(hallHasNext(0, 26), true);
  assert.equal(hallHasNext(1, 51), true);
  assert.equal(hallHasNext(2, 51), false);

  const items = Array.from({ length: 25 }, (_unused, index) => ({ id: `mem_${index}` }));
  assert.equal(hallCells(items).length, 25);
  assert.equal(hallCells(items)[0].id, 'mem_0', 'the first cell is the newest memory');
  assert.equal(hallCells(items)[24].id, 'mem_24');
  assert.equal(hallCells([]).filter((cell) => cell === null).length, 25, 'missing rows stay empty cells');
  assert.equal(hallCells(items.slice(0, 7))[7], null);
  assert.equal(hallIndex(1, 0), 25, 'wall 2 / row 1 / first ball = index 25');
  assert.equal(hallIndex(2, 24), 74);

  const compact = hallMetrics(0);
  assert.ok(compact.scale > 0.3 && compact.scale < 1, 'a narrow panel scales the preview down');
  assert.ok(compact.stageHeight > 200 && compact.stageHeight < 620);
  const wide = hallMetrics(900);
  assert.equal(wide.scale, 1, 'a wide panel renders the confirmed preview at 1:1');
  assert.equal(wide.stageHeight, 620);
});

test('P6/hall: the browser half is CSS-3D with a non-passive wheel and native buttons', () => {
  const { code } = loadBrowserHalf();

  for (const marker of [
    'perspective: 2000px',
    'transform-style: preserve-3d',
    '.ms-rack[data-rel="1"]',
    'translateX(170px)',
    'translateZ(-260px)',
    'brightness(.72)',
    'visibility:hidden',
    'prefers-reduced-motion',
    "{ passive: false }",
  ]) {
    assert.ok(code.includes(marker), `client.js must contain ${marker}`);
  }
  assert.ok(code.includes('ms-hall-scene'), 'the confirmed preview scene is scoped in the panel');
  assert.ok(code.includes("'?offset=' + index * HALL_SIZE + '&limit=' + HALL_SIZE"), 'walls come from the paged summary route');
  assert.ok(code.includes('disabled: !hallHasNext(wall, total)'), 'the next-wall button reflects the boundary');
  assert.ok(code.includes('type: \'button\''), 'balls stay native buttons');
  assert.ok(code.includes("const DETAIL = '/dsh-memsys/api/memory'"), 'clicking a ball still fetches by id');
  assert.equal((code.match(/dangerouslySetInnerHTML/g) ?? []).length, 1, 'only the <style> block injects markup');
  assert.equal((code.match(/innerHTML/g) ?? []).length, 0);
});
