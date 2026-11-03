import assert from 'node:assert/strict';
import test from 'node:test';

import { runtimeFromExec } from '../src/runtime/identity.mjs';
import { MODEL_AUTHOR_ROLES } from '../src/write/authority.mjs';

test('P6/identity: runtime comes only from exec; role is mapped into the memsys whitelist', () => {
  const missing = runtimeFromExec({ exec: null, tool: 'record', args: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'runtime_identity_unavailable');

  const forbidden = runtimeFromExec({ exec: null, tool: 'record', args: { sessionId: 'forged' } });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.code, 'validation_error');
  assert.equal(forbidden.field, 'sessionId');

  const exec = {
    callId: 'call-1',
    agent: { id: 'agent-1', session: { header: { id: 'session-1', lastSeq: 42 } } },
  };
  const resolved = runtimeFromExec({
    exec,
    tool: 'record',
    args: { kind: 'candidate' },
    ctx: { sessionProjections: { stateOf: () => ({ lastTurn: 7 }) } },
  });
  assert.equal(resolved.ok, true);
  assert.ok(MODEL_AUTHOR_ROLES.includes(resolved.runtime.role), 'role must be in the whitelist');
  assert.equal(resolved.runtime.role, 'daily');
  assert.deepEqual(resolved.runtime, {
    role: 'daily', identity: 'agent-1', agentId: 'agent-1', sessionId: 'session-1', callId: 'call-1', turn: 7, messageSeq: 42,
  });
});
