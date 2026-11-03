/**
 * Host tool registration, verified against the probe2 finding:
 *   defineTool({name, description, parameters, output, execute}) + ctx.tools.register
 * The plugin declares `inject = ['tools']`; offline (no ctx.tools) this module
 * never throws and returns tools-only.
 */

export const MEMSYS_TOOLS = Object.freeze([
  'memsys_get',
  'memsys_search',
  'memsys_project_get',
  'memsys_review_get',
  'memsys_self_get',
  'memsys_context_get',
  'memsys_record',
  'memsys_dream_record',
  'memsys_organize',
  'memsys_feed',
]);

const P = (type, description, extra = {}) => ({ type, description, ...extra });

export const TOOL_SPECS = Object.freeze({
  memsys_get: {
    description: 'Read memory items by explicit ids (current or history), with evidence and timeline.',
    parameters: {
      ids: P('array', 'Memory ids, 1 to 10', { items: { type: 'string' } }),
      view: P('string', 'current or history', { enum: ['current', 'history'] }),
      include_evidence: P('boolean', 'Include evidence rows'),
      cursor: P('string', 'Pagination cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
    },
  },
  memsys_search: {
    description: 'Search memories by keywords/topic/time/scene with a group index.',
    parameters: {
      keywords: P('string', 'Keyword expression'),
      scene: P('string', 'work, life or both', { enum: ['work', 'life', 'both'] }),
      topic_key: P('string', 'Registered topic key'),
      time_range: P('object', 'Business time range', { additionalProperties: true }),
      graph: P('object', 'Graph relation query (unsupported)', { additionalProperties: true }),
      cursor: P('string', 'Pagination cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
    },
  },
  memsys_project_get: {
    description: 'Read a project identity, Overview and version history.',
    parameters: {
      projectId: P('string', 'Project id', { required: true }),
      history: P('boolean', 'Include version history'),
      cursor: P('string', 'Pagination cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
    },
  },
  memsys_review_get: {
    description: 'Read candidates, needs-review items, due history, or confirmed dreams.',
    parameters: {
      ids: P('array', 'Object ids', { items: { type: 'string' } }),
      kind: P('string', 'candidate, pending, needs-review, due-history or dream', {
        enum: ['candidate', 'pending', 'needs-review', 'due-history', 'dream'],
      }),
      cursor: P('string', 'Pagination cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
    },
  },
  memsys_self_get: {
    description: 'Read self notes, judgments or speculations with split outcome/verdict.',
    parameters: {
      kind: P('string', 'self_note, judgment or speculation', { enum: ['self_note', 'judgment', 'speculation'] }),
      ids: P('array', 'Object ids', { items: { type: 'string' } }),
      cursor: P('string', 'Pagination cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
    },
  },
  memsys_context_get: {
    description: 'Expand one group of a frozen context snapshot.',
    parameters: {
      snapshot_revision: P('string', 'Snapshot revision', { required: true }),
      group_id: P('string', 'Group id', { required: true }),
      cursor: P('string', 'Group page cursor'),
      max_chars: P('number', 'Characters per page, 1000..16000'),
      view: P('string', 'current or history', { enum: ['current', 'history'] }),
    },
  },
  memsys_record: {
    description: 'Record candidates, judgments, self notes, project updates or owner-action proposals.',
    parameters: {
      kind: P('string', 'Record kind (validated by the service)', { required: true }),
      request_id: P('string', 'Stable request id (runtime may override)'),
      items: P('array', '1 to 20 record items', { items: { type: 'object', additionalProperties: true } }),
    },
  },
  memsys_dream_record: {
    description: 'Write one dream with propositions and inferred candidates in the dream library.',
    parameters: {
      linkedIds: P('array', 'Legal linked object ids', { items: { type: 'string' } }),
      basis: P('string', 'Why this dream was recorded', { required: true }),
      idea: P('string', 'Original dream text', { required: true }),
      propositions: P('array', '1 to 20 propositions', { items: { type: 'object', additionalProperties: true } }),
    },
  },
  memsys_organize: {
    description: 'Mechanical exact merge or a supersede proposal; never semantic rewriting.',
    parameters: {
      action: P('string', 'merge_exact or supersede_proposal', { enum: ['merge_exact', 'supersede_proposal'] }),
      ids: P('array', 'Memory ids for merge_exact', { items: { type: 'string' } }),
      oldMemoryId: P('string', 'Old memory id for supersede_proposal'),
      newMemoryId: P('string', 'New memory id for supersede_proposal'),
      reason: P('string', 'Reason'),
    },
  },
  memsys_feed: {
    description: 'Filter candidate feed items through relevance, detail and time gates. Never writes memory.',
    parameters: {
      keywords: P('array', 'Preference keywords', { items: { type: 'string' } }),
      recent_days: P('number', 'Window in days, 1..7'),
    },
  },
});


const NULLABLE = (type) => ({ oneOf: [{ type }, { type: 'null' }] });
const openObject = () => ({ type: 'object', additionalProperties: true, properties: {} });

export const TOOL_OUTPUT_SCHEMAS = Object.freeze({
  memsys_search: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      hits: { type: 'array', items: openObject() },
      group_index: openObject(),
      direct_hit_count: { type: 'integer' },
      evidence_mean: NULLABLE('number'),
      evidence_mean_status: { type: 'string' },
      evidence_formula: { type: 'string' },
      relation_search: { type: 'string' },
      relation_depth: NULLABLE('integer'),
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  memsys_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      items: { type: 'array', items: openObject() },
      missing_ids: { type: 'array', items: { type: 'string' } },
      snapshot_revision: { type: 'string' },
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  memsys_context_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      snapshot_revision: { type: 'string' },
      group_id: { type: 'string' },
      name: { type: 'string' },
      total_count: { type: 'integer' },
      deferred_count: { type: 'integer' },
      page_count: { type: 'integer' },
      remaining_count: { type: 'integer' },
      items: { type: 'array', items: openObject() },
      subgroup_total: { type: 'integer' },
      subgroups: { type: 'array', items: openObject() },
      subgroups_next_cursor: NULLABLE('string'),
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
      fresh_report_entry: openObject(),
    },
  },
  memsys_review_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      entries: { type: 'array', items: openObject() },
      total_count: { type: 'integer' },
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  memsys_self_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      kind: { type: 'string' },
      items: { type: 'array', items: openObject() },
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  memsys_project_get: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      project: openObject(),
      versions: { type: 'array', items: openObject() },
      versions_count: { type: 'integer' },
      headRevision: { type: 'integer' },
      effectiveRevision: { type: 'integer' },
      next_cursor: NULLABLE('string'),
      truncated: { type: 'boolean' },
      clock: { type: 'string' },
      code: { type: 'string' },
      message: { type: 'string' },
    },
  },
  // These surfaces have several success shapes; keep the root open until each
  // return shape is audited by a live call.
  memsys_record: openObject(),
  memsys_dream_record: openObject(),
  memsys_organize: openObject(),
  memsys_feed: openObject(),
});

function textRender(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return [{ type: 'text', text }];
}

/** Plain tool objects before the host wraps them with defineTool. */
export function enabledToolNames(modules = null) {
  const enabled = modules ?? { context: true, read: true, write: true, dream: true, projects: true, due: true, feed: true };
  return MEMSYS_TOOLS.filter((name) => {
    if (['memsys_get', 'memsys_search', 'memsys_review_get', 'memsys_context_get', 'memsys_self_get'].includes(name)) {
      return enabled.read !== false;
    }
    if (name === 'memsys_project_get') return enabled.read !== false && enabled.projects !== false;
    if (['memsys_dream_record', 'memsys_organize'].includes(name)) return enabled.dream !== false;
    if (name === 'memsys_feed') return enabled.feed !== false;
    if (name === 'memsys_record') return true; // registered but call-gated for an explicit module_disabled
    return true;
  });
}

export function toolDefinitions(handlers = {}, modules = null) {
  return enabledToolNames(modules).map((name) => {
    const spec = TOOL_SPECS[name];
    return {
      name,
      description: spec.description,
      parameters: spec.parameters,
      outputSchema: TOOL_OUTPUT_SCHEMAS[name] ?? openObject(),
      async execute(args, exec) {
        if (name === 'memsys_record' && modules?.write === false) {
          return { status: 'error', code: 'module_disabled', module: 'write' };
        }
        const handler = handlers[name];
        if (typeof handler !== 'function') {
          return { status: 'error', code: 'handler_unavailable', tool: name };
        }
        return handler(args ?? {}, exec);
      },
      render: (_args, value) => textRender(value),
    };
  });
}

export function toolCapabilityStatus(liveReport = null) {
  if (
    liveReport?.tools?.result === 'ok' &&
    liveReport.tools?.schemas_has_memsys === true &&
    liveReport.tools?.get_found === true
  ) {
    return {
      status: 'passed',
      capability: 'registration',
      execution: 'unverified',
      reason: null,
      evidence: liveReport.tools.evidence ?? null,
      tools: [...MEMSYS_TOOLS],
    };
  }
  return {
    status: 'unknown',
    reason: 'tool_registration_dynamic_unverified',
    tools: [...MEMSYS_TOOLS],
  };
}

/**
 * Register against a host ctx. No ctx.tools -> tools-only, no throw.
 * `defineTool` is resolved dynamically so offline tests never need the host package.
 */
export async function registerHostTools({ ctx = null, handlers = {}, modules = null, defineTool: injectedDefineTool = null } = {}) {
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    return { status: 'tools_only', registered: [], reason: 'no_tools_service', defineTool: null, tools: [...MEMSYS_TOOLS] };
  }
  let defineTool = injectedDefineTool;
  if (!defineTool) {
    try {
      ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
    } catch (err) {
      return {
        status: 'tools_only',
        registered: [],
        reason: 'dsh_tools_unavailable',
        import_error: err.message,
        defineTool: null,
        tools: [...MEMSYS_TOOLS],
      };
    }
  }
  const registered = [];
  const errors = [];
  for (const spec of toolDefinitions(handlers, modules)) {
    try {
      const tool = defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: {
          schema: spec.outputSchema,
          render: (_args, value) => [
            { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
          ],
        },
        execute: spec.execute,
      });
      ctx.tools.register(tool);
      registered.push(spec.name);
    } catch (err) {
      errors.push({ name: spec.name, message: err?.message ?? String(err) });
    }
  }
  if (errors.length > 0) {
    return {
      status: 'partial',
      registered,
      errors,
      defineTool: typeof defineTool,
      tools: [...MEMSYS_TOOLS],
    };
  }
  return { status: 'registered', registered, errors: [], defineTool: typeof defineTool, tools: [...MEMSYS_TOOLS] };
}

export { textRender };
