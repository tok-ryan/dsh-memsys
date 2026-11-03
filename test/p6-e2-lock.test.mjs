import assert from 'node:assert/strict';
import test from 'node:test';

import { issueReceipt, revalidateReceipt } from '../src/write/owner-actions.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

function issue(ctx, { hash = 'h-lock', base = ['v1'] } = {}) {
  return withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: 'p6-lock-' + Math.random(), action: 'master-verdict',
    payloadHash: hash, targetIds: ['j-lock'], baseVersions: base, nonce: 'n', inputEventId: 'e',
  })).receiptId;
}

test('P6/E2: lock-internal revalidation covers hash, base and consumed', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const receiptId = issue(ctx);
  const wrongHash = withImmediate(ctx.main, () => revalidateReceipt(ctx.main, ctx.clock, {
    receiptId, action: 'master-verdict', targetIds: ['j-lock'], payloadHash: 'other', baseVersions: ['v1'],
  }));
  assert.equal(wrongHash.code, 'receipt_hash_mismatch');

  const mismatchBase = withImmediate(ctx.main, () => revalidateReceipt(ctx.main, ctx.clock, {
    receiptId, action: 'master-verdict', targetIds: ['j-lock'], payloadHash: 'h-lock', baseVersions: ['v2'],
  }));
  assert.equal(mismatchBase.code, 'receipt_base_version_mismatch');

  const first = withImmediate(ctx.main, () => revalidateReceipt(ctx.main, ctx.clock, {
    receiptId, action: 'master-verdict', targetIds: ['j-lock'], payloadHash: 'h-lock', baseVersions: ['v1'],
  }));
  assert.equal(first.ok, true);
  const second = withImmediate(ctx.main, () => revalidateReceipt(ctx.main, ctx.clock, {
    receiptId, action: 'master-verdict', targetIds: ['j-lock'], payloadHash: 'h-lock', baseVersions: ['v1'],
  }));
  assert.equal(second.ok, false);
  assert.equal(second.code, 'receipt_already_consumed');
});
