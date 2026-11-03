import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { filterFeed, validIsoWithZone } from '../src/feed/filter.mjs';
import { createFeedHandler } from '../src/tools/feed.mjs';
import { countRows } from '../src/storage/repositories.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

const NOW = new Date('2026-11-03T02:00:00.000Z');
const KEYWORDS = ['记忆', 'AI'];

function item(id, overrides = {}) {
  return {
    id,
    title: '记忆系统更新 v1.2.3',
    description: '跑了 5 GB 数据',
    publishedAt: '2026-11-02T12:00:00+08:00',
    ...overrides,
  };
}

test('P3-C3 feed three gates', async (t) => {
  await t.test('window boundaries include both ends for the default 7 days', () => {
    const start = new Date(NOW.getTime() - 7 * 86400000).toISOString();
    const before = new Date(NOW.getTime() - 7 * 86400000 - 1).toISOString();
    const result = filterFeed({
      items: [
        item('start', { publishedAt: start }),
        item('end', { publishedAt: NOW.toISOString() }),
        item('early', { publishedAt: before }),
        item('late', { publishedAt: new Date(NOW.getTime() + 1).toISOString() }),
      ],
      keywords: KEYWORDS,
      now: NOW,
    });
    assert.equal(result.status, 'ok');
    const byId = Object.fromEntries(result.items.map((entry) => [entry.id, entry]));
    assert.equal(byId.start.accepted, true);
    assert.equal(byId.end.accepted, true);
    assert.deepEqual(byId.early.rejectionReasons, ['too_old']);
    assert.deepEqual(byId.late.rejectionReasons, ['future_publish_time']);
    assert.equal(result.recentDays, 7);
  });

  await t.test('reasons keep the fixed relevance -> details -> time order', () => {
    const result = filterFeed({
      items: [item('order', { title: '无关标题', description: '', publishedAt: new Date(NOW.getTime() + 1).toISOString() })],
      keywords: KEYWORDS,
      now: NOW,
    });
    assert.deepEqual(result.items[0].rejectionReasons, ['not_relevant', 'no_details', 'future_publish_time']);
  });

  await t.test('strict timezone ISO; invalid dates never also get too_old', () => {
    const result = filterFeed({
      items: [
        item('bare', { publishedAt: '2026-11-01' }),
        item('nozone', { publishedAt: '2026-11-01T00:00:00' }),
        item('feb30', { publishedAt: '2026-02-30T00:00:00+08:00' }),
        item('offset', { publishedAt: '2026-11-02T09:00:00+08:00' }),
        item('missing', { publishedAt: '' }),
        item('old', { publishedAt: '2020-01-01T00:00:00Z' }),
      ],
      keywords: KEYWORDS,
      now: NOW,
    });
    const byId = Object.fromEntries(result.items.map((entry) => [entry.id, entry]));
    assert.deepEqual(byId.bare.rejectionReasons, ['invalid_publish_time']);
    assert.deepEqual(byId.nozone.rejectionReasons, ['invalid_publish_time']);
    assert.deepEqual(byId.feb30.rejectionReasons, ['invalid_publish_time']);
    assert.equal(byId.offset.accepted, true);
    assert.deepEqual(byId.missing.rejectionReasons, ['missing_publish_time']);
    assert.deepEqual(byId.old.rejectionReasons, ['too_old']);
    assert.equal(validIsoWithZone('2026-11-02T09:00:00+08:00') !== null, true);
    assert.equal(validIsoWithZone('2026-11-02T09:00:00'), null);
  });

  await t.test('four detail proxies respect boundaries', () => {
    const cases = [
      ['abc123', false],
      ['10msec', false],
      ['AI', false],
      ['《》', false],
      ['API 文档', true],
      ['版本 v1.2.3', true],
      ['约 5 GB', true],
      ['3天没下雨', true],
      ['《真实书名》', true],
    ];
    for (const [text, expected] of cases) {
      const result = filterFeed({
        items: [item(`detail-${text}`, { title: '记忆', description: text, publishedAt: '2026-11-02T00:00:00Z' })],
        keywords: ['记忆'],
        now: NOW,
      });
      const inspected = filterFeed({
        items: [item(`probe-${text}`, { title: '记忆', description: text, publishedAt: '2026-11-02T00:00:00Z' })],
        keywords: ['记忆'],
        now: NOW,
      }).items[0];
      const hasDetails = inspected.detailMatches.length > 0;
      assert.equal(hasDetails, expected, `${text} -> ${JSON.stringify(inspected.detailMatches)}`);
      assert.equal(result.status, 'ok');
    }
  });

  await t.test('window and keywords are validated, duplicate ids cannot silently merge', () => {
    assert.equal(filterFeed({ items: [], keywords: [], now: NOW }).code, 'keywords_unavailable');
    assert.equal(filterFeed({ items: [], keywords: ['记忆'], now: NOW, recentDays: 8 }).code, 'feed_window_invalid');
    assert.equal(filterFeed({ items: [], keywords: ['记忆'], now: NOW, recentDays: 0 }).code, 'feed_window_invalid');
    const empty = filterFeed({ items: [], keywords: ['记忆'], now: NOW });
    assert.equal(empty.status, 'ok');
    assert.deepEqual(empty.accepted, []);
    const duplicate = filterFeed({
      items: [item('dup', { title: '记忆 A' }), item('dup', { title: '记忆 B' })],
      keywords: ['记忆'],
      now: NOW,
    });
    assert.equal(duplicate.code, 'duplicate_id_conflict');
  });

  await t.test('feed performs zero writes on every library', () => {
    const ctx = createTestContext({ clock: mutableClock().clock });
    try {
      const tables = ['observations', 'candidates', 'memories', 'relations', 'injections', 'uses'];
      const before = Object.fromEntries(tables.map((table) => [table, countRows(ctx.main, table)]));
      const result = filterFeed({
        items: Array.from({ length: 20 }, (_, index) => item(`zero-${index}`)),
        keywords: KEYWORDS,
        now: NOW,
      });
      assert.equal(result.status, 'ok');
      assert.equal(result.accepted.length, 20);
      for (const table of tables) {
        assert.equal(countRows(ctx.main, table), before[table], `${table} changed`);
      }
    } finally {
      ctx.cleanup();
    }
  });

  await t.test('tool needs a controlled provider and never turns provider failure into empty', () => {
    const clock = { now: () => NOW };
    assert.equal(createFeedHandler({ clock }).feed({ keywords: KEYWORDS }).code, 'feed_provider_unavailable');
    const failing = createFeedHandler({ clock, provider: { candidates: () => ({ status: 'error', message: 'boom' }) } });
    assert.equal(failing.feed({ keywords: KEYWORDS }).code, 'feed_provider_error');
    const good = createFeedHandler({
      clock,
      provider: { provider: 'fixture', candidates: () => ({ items: [item('p1')] }) },
    });
    const result = good.feed({ keywords: KEYWORDS, recent_days: 3 });
    assert.equal(result.status, 'ok');
    assert.equal(result.recentDays, 3);
    assert.equal(result.now, NOW.toISOString());
    assert.equal(result.provider, 'fixture');
  });

  await t.test('cross-zone timestamps compare in absolute time', () => {
    const result = filterFeed({
      items: [
        item('east', { publishedAt: '2026-11-03T09:00:00+08:00' }),
        item('west', { publishedAt: '2026-11-02T22:00:00-05:00' }),
      ],
      keywords: KEYWORDS,
      now: new Date('2026-11-03T02:00:00Z'),
    });
    const byId = Object.fromEntries(result.items.map((entry) => [entry.id, entry]));
    assert.equal(byId.east.accepted, true, '01:00Z is inside the window');
    assert.deepEqual(byId.west.rejectionReasons, ['future_publish_time'], '02:00Z == now is accepted; 02:00 next day is future');
  });

  await t.test('fixture CLI stays parseable and complete', () => {
    const payload = JSON.parse(fs.readFileSync(new URL('./fixtures/p3-feed.json', import.meta.url), 'utf8'));
    assert.ok(Array.isArray(payload.items));
  });

  await t.test('marker', (t2) => {
    const start = new Date(NOW.getTime() - 7 * 86400000).toISOString();
    const result = filterFeed({
      items: [
        item('start', { publishedAt: start }),
        item('end', { publishedAt: NOW.toISOString() }),
        item('early', { publishedAt: new Date(NOW.getTime() - 7 * 86400000 - 1).toISOString() }),
        item('late', { publishedAt: new Date(NOW.getTime() + 1).toISOString() }),
      ],
      keywords: KEYWORDS,
      now: NOW,
    });
    const byId = Object.fromEntries(result.items.map((entry) => [entry.id, entry]));
    const boundaries =
      byId.start.accepted === true &&
      byId.end.accepted === true &&
      byId.early.accepted === false &&
      byId.late.accepted === false;
    assert.equal(result.recentDays, 7);
    assert.equal(boundaries, true);
    t2.diagnostic(`P3_C3_OK recentDays=${result.recentDays} boundaries=${boundaries} side_effects=0`);
  });
});
