import assert from 'node:assert/strict';
import test from 'node:test';

import { issueReceipt, consumeReceipt, verifyReceiptBound } from '../src/write/owner-actions.mjs';
import { withImmediate } from '../src/storage/open.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

test('P6/E2: a receipt can be consumed exactly once', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const receiptId = withImmediate(ctx.main, () => issueReceipt(ctx.main, ctx.clock, {
    ownerId: 'owner', proposalId: 'p6-e2', action: 'master-verdict',
    payloadHash: 'h-e2', targetIds: ['j1'], baseVersions: ['v1'], nonce: 'n', inputEventId: 'e',
  })).receiptId;
  const first = consumeReceipt(ctx.main, ctx.clock, receiptId);
  assert.notEqual(first?.ok, false);
  const second = consumeReceipt(ctx.main, ctx.clock, receiptId);
  assert.equal(second?.ok, false);
  assert.equal(second?.code, 'receipt_already_consumed');
  const verified = verifyReceiptBound(ctx.main, {
    receiptId, action: 'master-verdict', targetIds: ['j1'], payloadHash: 'h-e2', baseVersions: ['v1'],
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'receipt_already_consumed');
});
