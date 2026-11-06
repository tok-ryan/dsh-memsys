import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { reviewGet } from '../src/read/review.mjs';
import { createReviewHandler } from '../src/runtime/review-ui.mjs';
import { replayMain } from '../src/storage/replay.mjs';
import { createRecordHandler } from '../src/tools/record.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

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

function getReview(handler, kind, options = {}) {
  const res = fakeRes();
  handler(fakeReq({ url: '/dsh-memsys/api/review?kind=' + kind, headers: { host: '127.0.0.1:50478' }, ...options }), res);
  return res;
}

function postReview(handler, payload) {
  const req = fakeReq({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:50478' },
    body: JSON.stringify(payload),
  });
  const res = fakeRes();
  handler(req, res);
  req.flush();
  return res;
}

function depsOf(ctx) {
  return { main: ctx.main, control: ctx.control, clock: ctx.clock };
}

/** Drive the real record path so the auto-promoted audit row is genuine. */
function seedAutoPromoted(ctx, text = '自动通过测试：主人在关注金价') {
  const runtime = fakeRuntime();
  const ingested = ingestInput(runtime, { text, messageSeq: 1 }, depsOf(ctx));
  const handler = createRecordHandler(depsOf(ctx));
  const responded = handler.record(runtime, {
    kind: 'candidate',
    request_id: 'p6-auto-promoted-ui',
    items: [{
      observationId: ingested.observation.id,
      text,
      why: '测试候选',
      type: 'fact',
      evidenceRefs: [{
        observationId: ingested.observation.id,
        sourceSpan: `bytes:0:${Buffer.byteLength(text, 'utf8')}`,
      }],
    }],
  });
  const item = responded.items[0];
  assert.equal(item.auto_promoted, true, JSON.stringify(item));
  return item;
}

test('P6/UI: auto-promoted list returns the audit fields the tab renders', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const item = seedAutoPromoted(ctx);
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock });

  const res = getReview(handler, 'auto-promoted');
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.kind, 'auto-promoted');
  assert.equal(body.total, 1);
  assert.equal(body.items.length, 1);
  const row = body.items[0];
  assert.equal(row.memory_id, item.memory_id, 'the promoted memory id is what revoke targets');
  assert.equal(row.close_reason, 'auto-promoted');
  assert.equal(row.text, '自动通过测试：主人在关注金价');
  assert.deepEqual(row.actions, ['revoke']);
  assert.ok(Number.isFinite(Date.parse(row.recorded_at)), 'has a real timestamp');
});

test('P6/UI: revoke demotes to retired and drops the row from the list, keeping audit rows', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const item = seedAutoPromoted(ctx, '自动通过测试：主人开始晨跑');
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock });

  const memoriesBefore = ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n;
  const queueBefore = ctx.main
    .prepare("SELECT COUNT(*) AS n FROM review_queue WHERE status = 'closed' AND close_reason = 'auto-promoted'")
    .get().n;

  const posted = postReview(handler, { kind: 'auto-promoted', id: item.memory_id, action: 'revoke' });
  assert.equal(posted.statusCode, 200, posted.body);
  const body = posted.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.state, 'retired');
  assert.equal(body.result.review_queue, 'preserved');

  const after = getReview(handler, 'auto-promoted');
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json().items, [], 'a revoked row leaves this list');

  // Demote, not delete: the memory row, the audit row and the tag all stay.
  assert.equal(ctx.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n, memoriesBefore, 'no physical delete');
  assert.equal(
    ctx.main.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE status = 'closed' AND close_reason = 'auto-promoted'").get().n,
    queueBefore,
    'the closed review queue row is audit evidence and stays',
  );
  assert.equal(replayMain(ctx.main).memories.get(item.memory_id), 'retired');

  const audit = reviewGet({ main: ctx.main, clock: ctx.clock, kind: 'auto-promoted' });
  assert.equal(audit.entries[0].status, 'revoked', 'the raw audit view still shows it as revoked');
});

test('P6/UI: a repeat revoke is idempotent, not an error', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const item = seedAutoPromoted(ctx);
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock });

  assert.equal(postReview(handler, { kind: 'auto-promoted', id: item.memory_id, action: 'revoke' }).statusCode, 200);
  const again = postReview(handler, { kind: 'auto-promoted', id: item.memory_id, action: 'revoke' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().result.replayed, true);
});

test('P6/UI: auto-promoted actions keep the same gate and refuse unknown actions', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const item = seedAutoPromoted(ctx);
  const handler = createReviewHandler({ main: ctx.main, control: ctx.control, dream: ctx.dream, clock: ctx.clock });

  const cross = getReview(handler, 'auto-promoted', { headers: { origin: 'https://evil.example', host: '127.0.0.1:50478' } });
  assert.equal(cross.statusCode, 403);

  const remote = getReview(handler, 'auto-promoted', { remoteAddress: '8.8.8.8' });
  assert.equal(remote.statusCode, 403);

  const invalid = getReview(handler, 'nonsense');
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, 'invalid_kind');

  const unknown = postReview(handler, { kind: 'auto-promoted', id: item.memory_id, action: 'promote' });
  assert.equal(unknown.statusCode, 409);
  assert.equal(unknown.json().ok, false);
  assert.equal(unknown.json().result.code, 'unknown_action');

  const empty = postReview(handler, { kind: 'auto-promoted', id: '', action: 'revoke' });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error, 'empty_id');
});

test('P6/UI: the auto-promoted tab is wired in client.js without touching the hall', () => {
  for (const marker of [
    "{ key: 'auto-promoted', label: '自动通过' }",
    "'auto-promoted': { title: '自动通过'",
    '暂无自动通过的记录',
    'memory_id: ',
    'close_reason: ',
    '确认撤销',
    "reason: 'owner_revoked_auto_promoted'",
  ]) {
    assert.ok(CODE.includes(marker), `client.js must contain ${marker}`);
  }
  // The memory-hall scene (previous task) is not part of this change.
  assert.ok(CODE.includes('ms-hall-scene'), 'the hall is still there');
  assert.ok(CODE.includes('ms-rack[data-rel="1"]'), 'the hall transform is still there');
});
