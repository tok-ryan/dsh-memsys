import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_OUTPUT_SCHEMAS } from '../src/runtime/tools.mjs';
import { createReadHandler } from '../src/tools/read.mjs';
import { createSelfHandler } from '../src/tools/self.mjs';
import { createProjectHandler } from '../src/tools/project.mjs';
import { ingestInput } from '../src/write/observe.mjs';
import { promoteCandidate, recordCandidates } from '../src/write/candidate.mjs';
import { createTestContext, mutableClock } from './helpers/fixtures.mjs';
import { fakeRuntime } from './helpers/runtime.mjs';

function validate(schema, value, path = 'value') {
  if (!schema) return;
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      try { validate(candidate, value, path); return true; } catch { return false; }
    });
    if (matches.length === 0) throw new Error(`${path}: no oneOf branch matched`);
    return;
  }
  const type = schema.type;
  if (type === 'string' && typeof value !== 'string') throw new Error(`${path} must be string`);
  if (type === 'integer' && !Number.isInteger(value)) throw new Error(`${path} must be integer`);
  if (type === 'number' && typeof value !== 'number') throw new Error(`${path} must be number`);
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
  if (type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be array`);
    if (schema.items) value.forEach((entry, index) => validate(schema.items, entry, `${path}[${index}]`));
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be object`);
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      if (!(key in properties)) {
        if (schema.additionalProperties === false) throw new Error(`${path}.${key}: additional property`);
        continue;
      }
      validate(properties[key], entry, `${path}.${key}`);
    }
  }
}

test('P6/schema: read tool outputs satisfy their registered output schemas', (t) => {
  const ctx = createTestContext({ clock: mutableClock().clock });
  t.after(() => ctx.cleanup());
  const runtime = fakeRuntime({ role: 'daily', identity: 'schema', callId: 'schema-1', messageSeq: 33000 });
  const observation = ingestInput(runtime, { text: 'schema 记忆', messageSeq: 33000 }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const created = recordCandidates(runtime, {
    items: [{ observationId: observation.observation.id, text: 'schema 记忆', why: 'w', type: 'fact', scene: 'work', scope: 'work-only', evidenceRefs: [{ observationId: observation.observation.id, sourceSpan: 'bytes:0:3' }] }],
  }, { main: ctx.main, control: ctx.control, clock: ctx.clock });
  const promoted = promoteCandidate(runtime, created.items[0].id, null, { main: ctx.main, control: ctx.control, clock: ctx.clock });

  const read = createReadHandler({ main: ctx.main, control: ctx.control, clock: ctx.clock });
  const outputs = {
    memsys_get: read.get({ ids: [promoted.id] }),
    memsys_search: read.search({ keywords: 'schema' }),
    memsys_review_get: read.review({ kind: 'candidate' }),
    memsys_context_get: read.context({ snapshot_revision: 'snap:missing', group_id: 'work:ungrouped' }),
    memsys_self_get: createSelfHandler({ main: ctx.main, clock: ctx.clock }).get({ kind: 'self_note' }),
    memsys_project_get: createProjectHandler({ main: ctx.main, clock: ctx.clock }).get({ projectId: 'missing' }),
  };
  for (const [name, output] of Object.entries(outputs)) {
    assert.doesNotThrow(() => validate(TOOL_OUTPUT_SCHEMAS[name], output, name), name);
  }
  assert.equal(typeof outputs.memsys_get.snapshot_revision, 'string');
  assert.ok(outputs.memsys_get.snapshot_revision.startsWith('rev_'));
});
