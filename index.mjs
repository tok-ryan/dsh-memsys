import fs from 'node:fs';
import { registerSection } from './src/runtime/inject.mjs';
import { registerHostTools, toolCapabilityStatus } from './src/runtime/tools.mjs';
import { openAll, closeAll } from './src/storage/open.mjs';
import { resolveConfig } from './src/config.mjs';
import { migrateAll } from './src/storage/migrate.mjs';
import { systemClock } from './src/clock.mjs';
import { createReadHandler } from './src/tools/read.mjs';
import { createProjectHandler } from './src/tools/project.mjs';
import { createDreamHandler } from './src/tools/dream.mjs';
import { createFeedHandler } from './src/tools/feed.mjs';
import { createSelfHandler } from './src/tools/self.mjs';
import { createRecordHandler } from './src/tools/record.mjs';
import { runtimeFromExec } from './src/runtime/identity.mjs';

export const name = 'dsh-memsys';
/** tools is a real host service; static inject is the verified registration path. */
export const inject = ['tools'];

function createHostHandlers(config = {}, ctx = null) {
  const dataDir = config.data_dir ?? process.env.MEMSYS_DATA_DIR ?? null;
  let handles = null;
  const db = () => {
    if (!dataDir) {
      const err = new Error('data_dir_missing');
      err.code = 'data_dir_missing';
      throw err;
    }
    if (!handles) {
      handles = openAll(resolveConfig({ dataDir }));
      migrateAll(handles, { clock: systemClock });
      if (process.env.MEMSYS_DISPATCH_PROBE) {
        try {
          const count = handles.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n;
          const handlerFile = process.env.MEMSYS_DISPATCH_PROBE + '.handler.json';
          const existing = fs.existsSync(handlerFile)
            ? JSON.parse(fs.readFileSync(handlerFile, 'utf8'))
            : {};
          fs.writeFileSync(
            handlerFile,
            JSON.stringify({ ...existing, data_dir: dataDir, memories: Number(count) }, null, 2),
            'utf8',
          );
        } catch {
          // diagnostics only
        }
      }
    }
    return handles;
  };
  const recordRuntime = (runtime) => {
    if (!process.env.MEMSYS_DISPATCH_PROBE) return;
    try {
      const file = process.env.MEMSYS_DISPATCH_PROBE + '.handler.json';
      const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      fs.writeFileSync(file, JSON.stringify({ ...existing, data_dir: dataDir, runtime }, null, 2), 'utf8');
    } catch {
      // diagnostics only
    }
  };
  const read = () => createReadHandler({ main: db().main, control: db().control, clock: systemClock, dream: db().dream });
  return {
    memsys_get: (args) => read().get(args),
    memsys_search: (args) => read().search(args),
    memsys_review_get: (args) => read().review(args),
    memsys_context_get: (args) => read().context(args),
    memsys_project_get: (args) => createProjectHandler({ main: db().main, clock: systemClock }).get(args),
    memsys_self_get: (args) => createSelfHandler({ main: db().main, clock: systemClock }).get(args),
    memsys_feed: (args) => createFeedHandler({ clock: systemClock }).feed(args),
    memsys_record: (args, exec) => {
      const identity = runtimeFromExec({ exec, ctx, tool: 'record', args });
      if (!identity.ok) return { status: 'error', code: identity.code, ...identity };
      recordRuntime(identity.runtime);
      return createRecordHandler({ main: db().main, control: db().control, clock: systemClock }).record(identity.runtime, args);
    },
    memsys_dream_record: (args, exec) => {
      const identity = runtimeFromExec({ exec, ctx, tool: 'dream_record', args });
      if (!identity.ok) return { status: 'error', code: identity.code, ...identity };
      recordRuntime(identity.runtime);
      return createDreamHandler({ main: db().main, dream: db().dream, control: db().control, clock: systemClock }).record(identity.runtime, args);
    },
    memsys_organize: (args, exec) => {
      const identity = runtimeFromExec({ exec, ctx, tool: 'dream_record', args });
      if (!identity.ok) return { status: 'error', code: identity.code, ...identity };
      recordRuntime(identity.runtime);
      return createDreamHandler({ main: db().main, dream: db().dream, control: db().control, clock: systemClock }).organize(identity.runtime, args);
    },
  };
}

/**
 * The organ registers its tools on every load (tools-only when the host offers
 * no tools service). Auto injection stays off by default; the diagnostic
 * section exists only for the isolated probe profile.
 */
export async function apply(ctx, config = {}) {
  const handlers = createHostHandlers(config, ctx);
  const registration = await registerHostTools({ ctx, handlers });
  const toolProbe = process.env.MEMSYS_TOOL_PROBE ?? null;
  const writeToolProbe = (deferred) => {
    if (!toolProbe) return;
    const evidence = {
      case: 'tools',
      deferred,
      registration: {
        status: registration.status,
        reason: registration.reason ?? null,
        import_error: registration.import_error ?? null,
        define_tool: registration.defineTool ?? null,
        registered: registration.registered ?? [],
        errors: registration.errors ?? [],
      },
      tools_service: Boolean(ctx?.tools && typeof ctx.tools.register === 'function'),
    };
    try {
      const schemas = ctx?.tools?.schemas?.() ?? [];
      evidence.schema_count = schemas.length;
      evidence.schema_names = schemas
        .map((entry) => entry?.name ?? entry?.function?.name ?? entry?.id ?? null)
        .filter(Boolean);
      evidence.schemas_has_memsys = evidence.schema_names.some((entry) => String(entry).startsWith('memsys_'));
      const found = ctx?.tools?.get?.('memsys_get') ?? null;
      evidence.get_found = Boolean(found);
      evidence.get_result = found ? 'found' : 'missing';
      evidence.result =
        evidence.schemas_has_memsys &&
        evidence.get_found &&
        registration.status === 'registered'
          ? 'ok'
          : 'fail';
    } catch (err) {
      evidence.result = 'fail';
      evidence.error = err.message;
    }
    try {
      fs.writeFileSync(toolProbe, JSON.stringify(evidence, null, 2), 'utf8');
    } catch {
      // diagnostic write must never break plugin load
    }
  };
  // Immediate baseline plus one deferred read: later plugins may register after us.
  writeToolProbe(false);
  if (toolProbe) setTimeout(() => writeToolProbe(true), 0);
  if (registration.status !== 'registered') {
    // Keep the status observable without claiming a capability.
    try {
      ctx?.logger?.info?.(`[memsys] tools ${registration.status}`);
    } catch {
      // logging must never break plugin load
    }
  }

  const dispatchProbe = process.env.MEMSYS_DISPATCH_PROBE ?? null;
  if (dispatchProbe) {
    const evidence = { case: 'dispatch', events: [], calls: [], schemas: [], errors: [] };
    const write = () => {
      try {
        fs.writeFileSync(dispatchProbe, JSON.stringify(evidence, null, 2), 'utf8');
      } catch {
        // diagnostic write must never break the tool path
      }
    };
    try {
      evidence.schemas = (ctx?.tools?.schemas?.() ?? [])
        .map((entry) => entry?.name ?? entry?.function?.name ?? entry?.id ?? null)
        .filter(Boolean);
    } catch (err) {
      evidence.errors.push({ where: 'schemas', message: err.message });
    }
    try {
      const originalExecute = ctx?.tools?.execute?.bind(ctx.tools);
      if (originalExecute) {
        ctx.tools.execute = async (...args) => {
          const name = typeof args[0] === 'string' ? args[0] : args[0]?.name ?? null;
          try {
            const result = await originalExecute(...args);
            const execArg = args[2] ?? args[1] ?? null;
            evidence.calls.push({
              name,
              args: JSON.stringify(args[1] ?? args[0] ?? null).slice(0, 800),
              exec: execArg?.agent?.session?.header?.id
                ? {
                    sessionId: execArg.agent.session.header.id,
                    callId: execArg.callId ?? null,
                    agentId: execArg.agent.id ?? null,
                  }
                : null,
              result: JSON.stringify(result ?? null).slice(0, 2000),
            });
            write();
            return result;
          } catch (err) {
            evidence.calls.push({ name, error: err.message });
            write();
            throw err;
          }
        };
      }
    } catch (err) {
      evidence.errors.push({ where: 'wrap_execute', message: err.message });
    }
    try {
      ctx?.on?.('session/event', (event) => {
        const log = Array.isArray(event?.log)
          ? event.log
          : Array.isArray(event?.surfaceManager?.log)
            ? event.surfaceManager.log
            : [];
        for (const entry of log) {
          if (!entry || typeof entry.type !== 'string') continue;
          if (!/tool|message|turn|assistant/i.test(entry.type)) continue;
          if (evidence.events.length >= 60) break;
          let data = null;
          try {
            data = JSON.stringify(entry.data ?? null).slice(0, 2500);
          } catch {
            data = String(entry.data).slice(0, 500);
          }
          if (evidence.events.some((seen) => seen.seq === entry.seq && seen.type === entry.type)) continue;
          evidence.events.push({ type: entry.type, seq: entry.seq ?? null, data });
          if (/tool\/call/i.test(entry.type)) {
            evidence.tool_calls = evidence.tool_calls ?? [];
            evidence.tool_calls.push({ type: entry.type, seq: entry.seq ?? null, data });
          }
          if (/tool\/result/i.test(entry.type)) {
            evidence.tool_results = evidence.tool_results ?? [];
            evidence.tool_results.push({ type: entry.type, seq: entry.seq ?? null, data });
          }
        }
        write();
      });
    } catch (err) {
      evidence.errors.push({ where: 'session_event', message: err.message });
    }
    write();
  }

  const autoInject = config.auto_inject === true;
  const diagnostic = config.diagnostic_section === true;
  let disposeSection = () => {};
  if (autoInject || diagnostic) {
    const getText = () =>
      autoInject
        ? '[memsys] 注入：tools-only（本批未取得宿主预算与回执，不作逐轮交付承诺）'
        : '[memsys] diagnostic section（auto_inject=false）';
    disposeSection = registerSection(ctx, {
      getText,
      diagnosticMarker: process.env.MEMSYS_SECTION_PROBE ?? null,
    });
  }
  return () => {
    disposeSection();
  };
}

export { toolCapabilityStatus };
