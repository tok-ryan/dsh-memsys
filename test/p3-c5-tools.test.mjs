import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEMSYS_TOOLS,
  registerHostTools,
  toolCapabilityStatus,
  toolDefinitions,
} from '../src/runtime/tools.mjs';
import { gateToolRegistration } from '../src/gates/checks.mjs';

function handlers() {
  return Object.fromEntries(MEMSYS_TOOLS.map((name) => [name, (args) => ({ tool: name, args })]));
}

test('P3-C5 host tool registration', async (t) => {
  await t.test('no host keeps tools-only and never throws', async () => {
    const result = await registerHostTools({ ctx: null, handlers: handlers() });
    assert.equal(result.status, 'tools_only');
    assert.deepEqual(result.registered, []);
    assert.equal(result.tools.length, MEMSYS_TOOLS.length);
  });

  await t.test('a host with tools.register receives every memsys tool', async () => {
    const captured = [];
    const ctx = { tools: { register(tool) { captured.push(tool); } } };
    const defineTool = (spec) => ({ ...spec, wrapped: true });
    const result = await registerHostTools({ ctx, handlers: handlers(), defineTool });
    assert.equal(result.status, 'registered');
    assert.deepEqual(result.registered.sort(), [...MEMSYS_TOOLS].sort());
    assert.equal(captured.length, MEMSYS_TOOLS.length);
    for (const tool of captured) {
      assert.equal(tool.wrapped, true);
      assert.ok(tool.parameters && Object.keys(tool.parameters).length > 0, tool.name);
      assert.equal(typeof tool.execute, 'function');
    }
    const get = captured.find((tool) => tool.name === 'memsys_get');
    assert.ok(get.parameters.ids);
    const executed = await get.execute({ ids: ['mem_1'] });
    assert.equal(executed.tool, 'memsys_get');
  });

  await t.test('missing handler yields an explicit tool error, not a crash', async () => {
    const captured = [];
    const ctx = { tools: { register(tool) { captured.push(tool); } } };
    await registerHostTools({ ctx, handlers: {}, defineTool: (spec) => spec });
    const tool = captured.find((entry) => entry.name === 'memsys_get');
    const result = await tool.execute({ ids: ['x'] });
    assert.equal(result.code, 'handler_unavailable');
  });

  await t.test('capability and gate stay unknown until dynamic evidence arrives', () => {
    assert.equal(toolCapabilityStatus(null).status, 'unknown');
    const unknownGate = gateToolRegistration();
    assert.equal(unknownGate.capability_status, 'unknown');
    assert.equal(unknownGate.ok, true);
    const live = { tools: { result: 'ok', schemas_has_memsys: true, get_found: true, evidence: 'probe13' } };
    assert.equal(toolCapabilityStatus(live).status, 'passed');
    const passedGate = gateToolRegistration({ liveReport: live });
    assert.equal(passedGate.capability_status, 'passed');
    assert.equal(passedGate.ok, true);
    const badLive = { tools: { result: 'ok', schemas_has_memsys: false, get_found: false } };
    assert.notEqual(gateToolRegistration({ liveReport: badLive }).capability_status, 'passed');
  });

  await t.test('schema subset matches the host defineTool rules', () => {
    const allowed = new Set(['type', 'description', 'title', 'default', 'examples', 'enum', 'const', 'items', 'properties', 'required', 'additionalProperties', 'oneOf']);
    const visit = (node, path) => {
      if (!node || typeof node !== 'object') return;
      for (const key of Object.keys(node)) {
        assert.ok(allowed.has(key), `${path} has unsupported keyword ${key}`);
      }
      if (node.type === 'object') {
        assert.equal(typeof node.additionalProperties, 'boolean', `${path} object needs explicit additionalProperties`);
        for (const [name, child] of Object.entries(node.properties ?? {})) visit(child, `${path}.${name}`);
      }
      if (node.type === 'array') {
        assert.ok(node.items, `${path} array needs items`);
        visit(node.items, `${path}[]`);
      }
    };
    for (const tool of toolDefinitions(handlers())) {
      for (const [name, child] of Object.entries(tool.parameters)) visit(child, `${tool.name}.${name}`);
    }
  });

  await t.test('tool definitions keep required fields and render text blocks', () => {
    const definitions = toolDefinitions(handlers());
    assert.equal(definitions.length, MEMSYS_TOOLS.length);
    const get = definitions.find((tool) => tool.name === 'memsys_get');
    assert.ok(get.parameters.ids);
    const blocks = get.render({}, { ok: true });
    assert.equal(blocks[0].type, 'text');
    assert.match(blocks[0].text, /ok/);
  });
});
