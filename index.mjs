import fs from 'node:fs';
import { registerSection } from './src/runtime/inject.mjs';
import { registerHostTools, toolCapabilityStatus } from './src/runtime/tools.mjs';
import { openAll, closeAll } from './src/storage/open.mjs';
import {
  PERSONA_MAX_CHARS,
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  resolveConfig,
  resolveDataDir,
} from './src/config.mjs';
import { migrateAll } from './src/storage/migrate.mjs';
import { createPersonaHandler, createPersonaStore } from './src/runtime/persona.mjs';
import { systemClock } from './src/clock.mjs';
import { createReadHandler } from './src/tools/read.mjs';
import { createProjectHandler } from './src/tools/project.mjs';
import { createDreamHandler } from './src/tools/dream.mjs';
import { createFeedHandler } from './src/tools/feed.mjs';
import { createSelfHandler } from './src/tools/self.mjs';
import { createRecordHandler } from './src/tools/record.mjs';
import { createQuizHandler } from './src/tools/quiz.mjs';
import { runtimeFromExec } from './src/runtime/identity.mjs';
import { createMemoryHandler, createSearchHandler, createSummaryHandler } from './src/runtime/summary.mjs';
import { mergeModules, resolveModulesDetail, writeUiConfig } from './src/runtime/ui-config.mjs';
import { createRoundInjector } from './src/runtime/inject-round.mjs';
import { loadAliases, setAliasProvider } from './src/read/expand.mjs';
import { createMemSysService, provideMemSysService } from './src/runtime/service.mjs';
import { compileRound } from './src/context/compile.mjs';
import { conservativeTokens } from './src/context/budget.mjs';

/**
 * Conservative host budget for the round injector: `conservativeTokens` counts
 * ceil(codepoints / 2), so 900 tokens ≈ 1800 characters of section text — enough
 * for a small directory, small enough that injection never crowds out the task.
 * A host that knows its real budget overrides this with `config.H`.
 */
const DEFAULT_HOST_BUDGET_TOKENS = 900;

export const name = 'dsh-memsys';
/** tools is a real host service; static inject is the verified registration path. */
export const inject = ['tools'];

/**
 * Module switches have three ranks, highest first:
 *   1. `<data_dir>/ui-config.json` — written by the settings page;
 *   2. the profile patch config (`auto_inject` / `modules`), which is itself a
 *      per-key overlay on the default map;
 *   3. every module on.
 * The file wins so a toggle survives a restart without rewriting the profile,
 * and the in-memory map is applied immediately (no restart).
 */
function createUiState(config = {}, logger = console) {
  // One resolver decides the directory (0.3.0: ~/.dsh/memsys). A profile
  // `data_dir` still works for one release but is deprecated, not the norm.
  const dataDir = resolveDataDir(config);
  if (typeof config.data_dir === 'string' && config.data_dir.trim().length > 0) {
    try {
      logger?.warn?.(
        `[dsh-memsys] config.data_dir 已废弃（0.3.0 起数据目录默认 ~/.dsh/memsys）；旧数据请运行 node scripts/migrate-datadir.mjs --from "${config.data_dir}"`,
      );
    } catch {
      // a logger that throws must never break boot
    }
  }
  const detail = resolveModulesDetail({ dataDir, profileConfig: config, logger });
  // One stable object: host tools capture it at registration, so a POST has to
  // mutate it in place or the call-time gates would keep reading stale values.
  const modules = { ...detail.modules };
  let source = detail.source;
  return {
    dataDir,
    get modules() {
      return modules;
    },
    get source() {
      return source;
    },
    get autoInject() {
      return modules.context !== false;
    },
    apply(written) {
      Object.assign(modules, written.modules);
      source = 'ui-config';
    },
    // Overridden by `apply` once the injector exists; the settings page reads it
    // through /api/summary so a dead injector is visible instead of silent.
    injectStatus: () => ({ level: 'unavailable', reason: 'not_started' }),
    sync: () => {},
  };
}

function createHostHandlers(config = {}, ctx = null, ui = null) {
  const dataDir = ui?.dataDir ?? resolveDataDir(config);
  const uiState = ui ?? {
    get modules() {
      return mergeModules(config, null);
    },
    get source() {
      return typeof config.auto_inject === 'boolean' || config.modules ? 'profile' : 'default';
    },
    get autoInject() {
      return mergeModules(config, null).context !== false;
    },
    apply() {},
    sync: () => {},
  };
  const uiSearch = createSearchHandler({ main: () => db().main, clock: systemClock });
  // One memory by id, through the same read handler the memsys_get tool uses.
  const uiMemory = createMemoryHandler({ load: (id) => read().get({ ids: [id] }) });
  const uiSummary = createSummaryHandler({
    main: () => db().main,
    dataDir,
    getConfig: () => ({ modules: uiState.modules, source: uiState.source, inject: uiState.injectStatus() }),
    onConfig: (patch) => {
      const written = writeUiConfig(dataDir, patch);
      uiState.apply(written);
      uiState.sync();
      return { auto_inject: written.auto_inject, modules: written.modules };
    },
  });
  let handles = null;
  const db = () => {
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
    memsys_quiz: (args) => createQuizHandler({ main: db().main, clock: systemClock }).run(args),
    memsys_ui_summary: (req, res) => uiSummary(req, res),
    memsys_ui_search: (req, res) => uiSearch(req, res),
    memsys_ui_memory: (req, res) => uiMemory(req, res),
    // Cross-plugin surface: `ctx.provide('memsys', …)` exposes this instance.
    memsys_service: () => createMemSysService({ main: db().main, control: db().control, clock: systemClock }),
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
  const ui = createUiState(config);
  // 私人别名（口语 → 记忆里的写法）只从数据目录读，永不进 npm 包。
  // 别名层是可选的：文件不存在或 JSON 坏了就当空，检索仍按通用词工作。
  try {
    setAliasProvider(() => loadAliases(ui.dataDir));
  } catch {
    // 没有数据目录时保持 null provider
  }
  const handlers = createHostHandlers(config, ctx, ui);
  const registration = await registerHostTools({ ctx, handlers, modules: ui.modules });

  // Persona: versioned text under `<dataDir>/persona/`, owner-only writes, with
  // its own section that always assembles before the memory section.
  const persona = createPersonaStore({
    dataDir: ui.dataDir,
    maxChars: config.persona_max_chars ?? PERSONA_MAX_CHARS,
    logger: ctx?.logger ?? console,
  });
  const personaHandler = createPersonaHandler({
    store: persona,
    logger: ctx?.logger ?? console,
    onSaved: () => {
      try {
        ui.sync();
      } catch {
        // the new version is already on disk; a refresh failure is not a save failure
      }
    },
  });

  // Optional cross-plugin service: other plugins reach memsys through
  // `ctx.get('memsys')`. Registration needs `ctx.provide`; a profile (or a fake
  // harness in tests) without it simply keeps the service unprovided.
  if (typeof ctx?.provide === 'function' && typeof handlers.memsys_service === 'function') {
    try {
      provideMemSysService(ctx, handlers.memsys_service());
    } catch {
      // no data dir yet, or the host refused the registration: tools still work
    }
  }

  // The round injector owns the session/turn subscription; the section only
  // reads its current text. Verified empirically: a section's `text` function is
  // re-evaluated on every `systemPrompt.assemble()` (once per model step), so no
  // per-turn re-mount is needed — a toggle only has to change what `current()` says.
  let injector = null;
  const syncInjector = () => {
    if (ui.modules.context === false || !ui.dataDir) {
      injector?.dispose?.();
      injector = null;
      return;
    }
    if (!injector) {
      injector = createRoundInjector({
        ctx,
        dataDir: ui.dataDir,
        modules: ui.modules,
        compileRound,
        // A profile patch cannot carry a function or a host number, so both
        // default anyway: without them compileRound degrades to tools-only and
        // the section becomes an empty shell that never injects a memory.
        tokenizer: config.tokenizer ?? conservativeTokens,
        H: config.H ?? DEFAULT_HOST_BUDGET_TOKENS,
        mode: config.mode ?? 'work',
      });
      try {
        injector.refresh({});
      } catch {
        // a failed first compile must not stop the host half from booting
      }
    }
  };
  ui.injectStatus = () => {
    if (ui.modules.context === false) return { level: 'disabled', reason: 'context_off' };
    if (!injector) return { level: 'unavailable', reason: ui.dataDir ? 'injector_failed' : 'data_dir_missing' };
    const level = injector.current?.().delivery_level ?? 'unavailable';
    return { level, reason: level === 'unavailable' ? 'compile_unavailable' : null };
  };
  syncInjector();
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

  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['webServer'], (web) => {
        web.effect(
          () =>
            web.webServer.register({
              kind: 'exact',
              path: '/dsh-memsys/api/summary',
              handler: (req, res) => handlers.memsys_ui_summary(req, res),
            }),
          'memsys: ui summary route',
        );
        web.effect(
          () =>
            web.webServer.register({
              kind: 'exact',
              path: '/dsh-memsys/api/config',
              handler: (req, res) => handlers.memsys_ui_summary(req, res),
            }),
          'memsys: ui config route',
        );
        web.effect(
          () =>
            web.webServer.register({
              kind: 'exact',
              path: '/dsh-memsys/api/search',
              handler: (req, res) => handlers.memsys_ui_search(req, res),
            }),
          'memsys: ui search route',
        );
        web.effect(
          () =>
            web.webServer.register({
              kind: 'exact',
              path: '/dsh-memsys/api/memory',
              handler: (req, res) => handlers.memsys_ui_memory(req, res),
            }),
          'memsys: ui memory route',
        );
        web.effect(
          () =>
            web.webServer.register({
              kind: 'exact',
              path: '/dsh-memsys/api/persona',
              handler: (req, res) => personaHandler(req, res),
            }),
          'memsys: ui persona route',
        );
      });
    } catch {
      // profiles without webServer stay headless
    }
  }
  const diagnostic = config.diagnostic_section === true;
  let disposePersona = () => {};
  let disposeSection = () => {};
  const syncSection = () => {
    disposePersona();
    disposePersona = () => {};
    disposeSection();
    disposeSection = () => {};
    // Persona is part of context injection, so it follows the same master
    // switch. It is registered first (order 400) so it always assembles before
    // the memory section (order 500); `persona_section:false` only drops it.
    if (ui.modules.context !== false && config.persona_section !== false) {
      if (persona.sectionText()) {
        disposePersona = registerSection(ctx, {
          name: PERSONA_SECTION_NAME,
          order: PERSONA_SECTION_ORDER,
          getText: () => persona.sectionText() ?? '',
          dynamicText: true,
        });
      }
    }
    // The section is owned by the `context` module; the probe profile may force
    // a diagnostic section even while injection is off.
    if (ui.modules.context === false && !diagnostic) return;
    disposeSection = registerSection(ctx, {
      getText: () =>
        ui.modules.context === false
          ? '[memsys] diagnostic section（context=false）'
          : (injector?.current().text ?? ''),
      dynamicText: true,
      diagnosticMarker: process.env.MEMSYS_SECTION_PROBE ?? null,
    });
  };
  // A profile without systemPrompt (headless/embedded) must still boot the tools.
  ui.sync = () => {
    try {
      syncInjector();
      syncSection();
    } catch {
      // keep the host half alive; the section is optional
    }
  };
  ui.sync();
  return () => {
    disposePersona();
    disposeSection();
    injector?.dispose?.();
  };
}

export { toolCapabilityStatus };
