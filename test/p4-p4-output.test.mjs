import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_OUTPUT_SCHEMAS } from '../src/runtime/tools.mjs';

test('P4/dispatch: output schemas cover the real tool return fields', () => {
  const required = {
    memsys_search: ['status', 'hits', 'group_index', 'direct_hit_count', 'next_cursor', 'truncated', 'clock'],
    memsys_get: ['status', 'items', 'missing_ids', 'next_cursor', 'truncated', 'clock'],
    memsys_context_get: ['status', 'snapshot_revision', 'group_id', 'name', 'total_count', 'items', 'next_cursor', 'truncated', 'clock'],
  };
  for (const [tool, fields] of Object.entries(required)) {
    const schema = TOOL_OUTPUT_SCHEMAS[tool];
    assert.ok(schema, tool + ' has no output schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false, tool + ' must declare fields explicitly');
    for (const field of fields) {
      assert.ok(Object.hasOwn(schema.properties, field), `${tool} schema missing ${field}`);
    }
  }
});
