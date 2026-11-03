import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRound } from '../src/context/compile.mjs';
import { conservativeTokens } from '../src/context/budget.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';

test('P6/E8: compile failures freeze the logical session+round stream', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const deps = { main: ctx.main, control: ctx.control, clock: ctx.clock, sessionId: 's-fail', roundId: 'r-fail' };
  const badTokenizer = () => {
    throw new Error('tokenizer_down');
  };
  for (let i = 0; i < 3; i += 1) {
    assert.throws(() => compileRound({ ...deps, mode: 'work', roundId: 'r-fail', sessionId: 's-fail', tokenizer: badTokenizer, H: 1000 }), /tokenizer_down/);
  }
  assert.throws(
    () => compileRound({ ...deps, mode: 'work', roundId: 'r-fail', sessionId: 's-fail', tokenizer: conservativeTokens, H: 1000 }),
    (err) => err.code === 'object_frozen',
  );
  const frozen = ctx.control
    .prepare("SELECT frozen FROM object_streams WHERE object_key = ?")
    .get('compile:s-fail:r-fail');
  assert.equal(Number(frozen?.frozen), 1, 'freeze must persist');
});
