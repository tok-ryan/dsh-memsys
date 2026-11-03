import { resolveConfig } from '../config.mjs';
import { openAll } from '../storage/open.mjs';
import { migrateAll } from '../storage/migrate.mjs';
import { systemClock } from '../clock.mjs';
import { withImmediate } from '../storage/open.mjs';

const TOOLS_ONLY_TEXT = '[memsys] 注入：tools-only（未取得宿主预算与回执，不作逐轮交付承诺）';

function sessionIdOf(turn) {
  return turn?.session?.header?.id ?? turn?.sessionId ?? turn?.session?.id ?? null;
}

/**
 * Runtime bridge between session turn events and the compile pipeline.
 * Subscription is owned here (not the section), so a new turn refreshes text
 * before the next prompt section read; no reply receipt means delivery=unknown.
 */
export function createRoundInjector({
  ctx = null,
  dataDir,
  modules = null,
  compileRound,
  tokenizer = null,
  H = null,
  mode = 'work',
  clock = systemClock,
  logger = console,
  handles = null,
} = {}) {
  const ownedHandles = !handles;
  const stores = handles ?? openAll(resolveConfig({ dataDir }));
  if (ownedHandles) migrateAll(stores, { clock });
  let state = {
    text: '',
    delivery: 'unknown',
    delivery_level: 'empty',
    manifest: null,
    sessionId: null,
    roundId: null,
    refreshed_at: null,
  };
  let counter = 0;
  let disposed = false;

  const disabled = modules?.context === false;

  function recordInjections(roundId, manifest) {
    const ids = manifest?.eligible_ids ?? [];
    if (!ids.length) return;
    const at = clock.at().at;
    withImmediate(stores.main, () => {
      for (const memoryId of ids) {
        stores.main
          .prepare('INSERT OR IGNORE INTO injections (round_id, memory_id, slots, topic_hits, manifest_hash, receipt_id, at) VALUES (?, ?, ?, 0, ?, NULL, ?)')
          .run(roundId, memoryId, JSON.stringify(['context']), manifest?.manifest_hash ?? null, at);
      }
    });
  }

  function refresh(turn = {}) {
    if (disposed) return state;
    if (disabled) {
      state = { text: '', delivery: 'unknown', delivery_level: 'disabled', manifest: null, sessionId: sessionIdOf(turn), roundId: null, refreshed_at: clock.at().at };
      return state;
    }
    const sessionId = sessionIdOf(turn) ?? state.sessionId;
    counter += 1;
    const roundId = turn?.id ?? turn?.roundId ?? `turn-${Date.now()}-${counter}`;
    let result;
    try {
      result = compileRound({
        main: stores.main,
        control: stores.control,
        clock,
        sessionId: sessionId ?? 'unknown-session',
        roundId,
        mode,
        tokenizer,
        H,
        modules,
      });
    } catch (err) {
      logger?.warn?.('[dsh-memsys] compile failed: ' + err.message);
      result = null;
    }
    if (!result || result.delivery_level === 'unavailable') {
      state = {
        text: TOOLS_ONLY_TEXT,
        delivery: 'unknown',
        delivery_level: 'unavailable',
        manifest: result?.manifest ?? null,
        sessionId,
        roundId,
        refreshed_at: clock.at().at,
      };
      return state;
    }
    const text = result.section?.text ?? result.sectionText ?? '';
    state = {
      text,
      delivery: 'unknown',
      delivery_level: result.delivery_level,
      manifest: result.manifest ?? null,
      sessionId,
      roundId,
      refreshed_at: clock.at().at,
    };
    recordInjections(roundId, state.manifest);
    return state;
  }

  function onSessionEvent(payload) {
    const event = payload?.event ?? payload;
    const type = event?.type ?? event?.name ?? event?.kind ?? null;
    if (type !== 'turn/start') return;
    refresh(payload?.turn ?? event?.turn ?? payload ?? {});
  }

  if (!disabled && typeof ctx?.on === 'function') {
    ctx.on('session/event', onSessionEvent);
    ctx.on('turn/start', (payload) => refresh(payload ?? {}));
  }

  return {
    refresh,
    current: () => state,
    dispose() {
      disposed = true;
      try {
        if (typeof ctx?.off === 'function') {
          ctx.off('session/event', onSessionEvent);
        }
      } catch {
        // disposal must not throw
      }
    },
  };
}
