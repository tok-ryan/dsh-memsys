import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareBusinessRows,
  compareDatabaseFreeze,
  snapshotBusinessRows,
  snapshotDatabaseFreeze,
} from '../src/import/rollback.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

test('P6/L6: rollback detects changed row content even when counts match', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  ctx.main
    .prepare("INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at) VALUES ('obs_l6_content','obs:l6c',?, 'h','原始内容','file','unknown','{}','migrated',0,'{}',0.5,?)")
    .run(ctx.clock.at().at, ctx.clock.at().at);
  const baseline = snapshotBusinessRows(ctx.main);
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_observations_no_update');
  ctx.main.prepare('UPDATE observations SET text = ? WHERE id = ?').run('改过的内容', 'obs_l6_content');
  const compared = compareBusinessRows({ db: ctx.main, baseline });
  assert.equal(compared.ok, false, 'same count must not pass when content changed');
  assert.ok(compared.missing.some((entry) => entry.includes('content')), JSON.stringify(compared));
});

test('P6/L6: boundary freeze detects changed content with unchanged counts', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  ctx.main
    .prepare("INSERT INTO observations (id, idempotency_key, at, payload_hash, text, source, author_kind, runtime_refs, origin, lossy, state_snapshot, initial_strength, recorded_at) VALUES ('obs_l6_freeze','obs:l6f',?, 'h','原始','file','unknown','{}','migrated',0,'{}',0.5,?)")
    .run(ctx.clock.at().at, ctx.clock.at().at);
  const freeze = snapshotDatabaseFreeze(ctx.handles);
  ctx.main.exec('DROP TRIGGER IF EXISTS trg_observations_no_update');
  ctx.main.prepare('UPDATE observations SET text = ? WHERE id = ?').run('改过', 'obs_l6_freeze');
  const compared = compareDatabaseFreeze(ctx.handles, freeze);
  assert.equal(compared.ok, false);
  assert.ok(compared.missing.some((entry) => entry.includes('content')), JSON.stringify(compared));
});
