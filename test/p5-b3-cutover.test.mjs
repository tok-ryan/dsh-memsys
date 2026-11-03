import assert from 'node:assert/strict';
import test from 'node:test';

import { cutoverGate } from '../src/import/legacy.mjs';
import { snapshotBusinessRows, compareBusinessRows } from '../src/import/rollback.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

test('P5/B3: anomalies block cutover even when verify is ok', () => {
  assert.equal(cutoverGate({ status: 'ok', unresolved: 0, anomalies: 1 }), 'anomalies_present');
  assert.equal(cutoverGate({ status: 'ok', unresolved: 0, anomalies: 0 }), null);
});

test('P5/B3: rollback compares row identity, not only counts', (t) => {
  const a = createTestContext({ clock: mutableClock().clock });
  const b = createTestContext({ clock: mutableClock().clock });
  t.after(() => { a.cleanup(); b.cleanup(); });
  const insert = (ctx, id) => {
    ctx.main
      .prepare(
        "INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at) VALUES (?, ?, ?, 'h', ?, 'file', 'unknown', '{}', 'migrated', 0, '{}', 0.5, ?)",
      )
      .run(id, `obs:${id}`, ctx.clock.at().at, id, ctx.clock.at().at);
  };
  insert(a, 'obs_p5b3_a');
  insert(b, 'obs_p5b3_b');
  const baseline = snapshotBusinessRows(a.main);
  const sameCounts = compareBusinessRows({ db: b.main, baseline });
  assert.equal(sameCounts.ok, false);
  assert.ok(sameCounts.missing.some((entry) => entry.includes('obs_p5b3_a')), JSON.stringify(sameCounts));
});
