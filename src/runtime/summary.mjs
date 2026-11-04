/**
 * Host side of the optional Web UI (sidebar panel + settings section).
 *
 * Read-only over SQLite, plus the module switches read through `ui-config.mjs`
 * (the same source the host gates use). Both routes enforce loopback +
 * same-origin before touching data; nothing here is model-facing.
 */
import {
  DEFAULT_MODULES,
  MODULE_KEYS,
  readUiConfig,
  resolveModulesDetail,
  writeUiConfig,
} from './ui-config.mjs';
import { searchMemories } from '../read/search.mjs';

const RECENT_LIMIT = 5;
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;
const QUERY_MAX_CHARS = 200;
// 主人要求：卡片展示 120 字（按码点截断，预算保护仍在 host 侧）
const TEXT_LIMIT = 120;
const BODY_LIMIT = 4096;

const truncate = (text) => Array.from(String(text ?? '')).slice(0, TEXT_LIMIT).join('');

/** Three counts, the five latest memories, the module map, and injector health. */
export function buildSummary(
  main,
  {
    dataDir = null,
    modules = DEFAULT_MODULES,
    modulesSource = 'default',
    autoInject = undefined,
    inject = { level: 'unavailable', reason: 'not_started' },
  } = {},
) {
  const db = typeof main === 'function' ? main() : main;
  const one = (sql, ...params) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const recent = db
    .prepare(
      'SELECT id, text, type, weight, recorded_at FROM memories ORDER BY recorded_at DESC, id DESC LIMIT ?',
    )
    .all(RECENT_LIMIT)
    // type/weight/recorded_at ride along so the shelf can colour a ball by what
    // kind of memory it is and size it by weight. They are additive: older
    // clients that only read id/text are unaffected.
    .map((row) => ({
      id: row.id,
      text: truncate(row.text),
      type: row.type ?? null,
      weight: typeof row.weight === 'number' ? row.weight : null,
      recorded_at: row.recorded_at ?? null,
    }));
  const effective = {};
  for (const key of MODULE_KEYS) effective[key] = modules?.[key] !== false;
  return {
    memories: one('SELECT COUNT(*) AS n FROM memories'),
    // total === memories, stated explicitly so the panel never has to guess
    // whether "记忆 N 条" counts everything or only the balls it renders.
    total: one('SELECT COUNT(*) AS n FROM memories'),
    recent_limit: RECENT_LIMIT,
    candidates: one("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('pending', 'conflicted')"),
    pending_due: one("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'pending-due'"),
    recent,
    data_dir: dataDir,
    auto_inject: autoInject === undefined ? effective.context : autoInject === true,
    auto_inject_source: modulesSource,
    modules: effective,
    modules_source: modulesSource,
    // Without this the "on" switch can be a lie: the injector may be running on
    // tools-only text because no tokenizer/H reached it.
    inject: { level: inject?.level ?? 'unavailable', reason: inject?.reason ?? null },
  };
}

/**
 * Search over the existing retrieval layer — no second query implementation.
 * The search layer returns ids and text; kind/created_at come from one lookup by
 * id, and per-item score is not exposed by it (null rather than invented).
 */
export function buildSearch(main, { q, limit = SEARCH_LIMIT_DEFAULT, clock } = {}) {
  const db = typeof main === 'function' ? main() : main;
  const result = searchMemories({ main: db, clock, keywords: q, maxChars: 16000 });
  if (result?.status !== 'ok') return { status: 'error', code: result?.code ?? 'search_failed' };
  const hits = result.hits ?? [];
  const ids = hits.map((hit) => hit.id);
  const meta = new Map();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT id, type, recorded_at FROM memories WHERE id IN (${placeholders})`).all(...ids)) {
      meta.set(row.id, row);
    }
  }
  const items = hits.slice(0, limit).map((hit) => ({
    id: hit.id,
    text: truncate(hit.text),
    kind: meta.get(hit.id)?.type ?? null,
    created_at: meta.get(hit.id)?.recorded_at ?? null,
    score: null,
  }));
  return { status: 'ok', q, items, total: Number(result.direct_hit_count ?? items.length) };
}

function readQuery(url) {
  const raw = String(url ?? '');
  const index = raw.indexOf('?');
  if (index < 0) return new URLSearchParams('');
  try {
    return new URLSearchParams(raw.slice(index + 1));
  } catch {
    return new URLSearchParams('');
  }
}

/**
 * GET /dsh-memsys/api/search?q=…&limit=…
 * Same loopback + same-origin gate as the summary route; text is truncated to
 * the same 120 codepoints the panel shows, and always keeps its id.
 */
export function createSearchHandler({ main, clock, logger = console } = {}) {
  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  return (req, res) => {
    if (!isLoopback(req) || !sameOrigin(req)) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    if (req.method && req.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const params = readQuery(req.url);
    const q = String(params.get('q') ?? '').trim();
    if (!q) {
      send(res, 400, { error: 'empty_query' });
      return;
    }
    if (Array.from(q).length > QUERY_MAX_CHARS) {
      send(res, 400, { error: 'query_too_long' });
      return;
    }
    const rawLimit = Number(params.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(SEARCH_LIMIT_MAX, Math.floor(rawLimit))
      : SEARCH_LIMIT_DEFAULT;
    try {
      const result = buildSearch(main, { q, limit, clock });
      if (result.status !== 'ok') {
        send(res, 503, { error: 'search_unavailable', message: String(result.code) });
        return;
      }
      send(res, 200, { q: result.q, items: result.items, total: result.total });
    } catch (err) {
      logger?.warn?.(`[dsh-memsys] search failed: ${err?.message ?? err}`);
      send(res, 503, { error: 'search_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}

const MEMORY_ID_PATTERN = /^mem_[0-9A-Za-z:_-]{1,200}$/;

/**
 * GET /dsh-memsys/api/memory?id=mem_…
 * Reads one memory through the same read path as memsys_get; 404 when the id
 * does not resolve, 503 when the read layer itself fails.
 */
export function createMemoryHandler({ load } = {}) {
  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  return (req, res) => {
    if (!isLoopback(req) || !sameOrigin(req)) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    if (req.method && req.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const id = String(readQuery(req.url).get('id') ?? '').trim();
    if (!id) {
      send(res, 400, { error: 'empty_id' });
      return;
    }
    if (!MEMORY_ID_PATTERN.test(id)) {
      send(res, 400, { error: 'invalid_id' });
      return;
    }
    try {
      const result = load?.(id);
      const item = (result?.items ?? []).find((entry) => entry.id === id) ?? null;
      if (!item) {
        send(res, 404, { error: 'not_found' });
        return;
      }
      send(res, 200, {
        id: item.id,
        text: truncate(item.text),
        kind: item.type ?? null,
        created_at: item.recorded_at ?? null,
      });
    } catch (err) {
      send(res, 503, { error: 'memory_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}

export function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function sameOrigin(req) {
  const origin = req?.headers?.origin;
  const host = req?.headers?.host;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * One handler for GET summary and POST config.
 *
 * `main` may be a thunk so a profile that never opened the database still gets
 * a structured 503 instead of a thrown route error.
 */
export function createSummaryHandler({
  main,
  dataDir = null,
  getConfig = () => ({ modules: DEFAULT_MODULES, source: 'default' }),
  onConfig = null,
} = {}) {
  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  const snapshot = () => {
    const current = getConfig() ?? {};
    const modules = current.modules ?? DEFAULT_MODULES;
    return {
      modules,
      source: current.source ?? 'default',
      auto_inject: modules?.context !== false,
      inject: current.inject ?? { level: 'unavailable', reason: 'not_started' },
    };
  };

  return (req, res) => {
    if (!isLoopback(req) || !sameOrigin(req)) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    if (req.method === 'POST') {
      const type = String(req.headers?.['content-type'] ?? '').toLowerCase();
      if (!type.includes('application/json')) {
        send(res, 415, { error: 'json_required' });
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on?.('data', (chunk) => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > BODY_LIMIT) tooLarge = true;
      });
      req.on?.('end', () => {
        if (tooLarge) {
          send(res, 413, { error: 'body_too_large' });
          return;
        }
        let parsed = null;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          send(res, 400, { error: 'invalid_json' });
          return;
        }
        const wantsModules = parsed?.modules && typeof parsed.modules === 'object';
        const wantsAutoInject = typeof parsed?.auto_inject === 'boolean';
        if (!wantsModules && !wantsAutoInject) {
          send(res, 400, { error: 'config_required' });
          return;
        }
        if (wantsModules) {
          const bad = Object.keys(parsed.modules).filter(
            (key) => MODULE_KEYS.includes(key) && typeof parsed.modules[key] !== 'boolean',
          );
          if (bad.length > 0) {
            send(res, 400, { error: 'module_value_not_boolean', keys: bad });
            return;
          }
        }
        try {
          const written = onConfig?.({ ...parsed }) ?? null;
          const next = written ?? snapshot();
          send(res, 200, {
            ok: true,
            auto_inject: next.auto_inject,
            auto_inject_source: 'ui-config',
            modules: next.modules,
            modules_source: 'ui-config',
          });
        } catch (err) {
          send(res, 500, { error: 'write_failed', message: String(err?.message ?? err) });
        }
      });
      return;
    }
    if (req.method && req.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    try {
      const state = snapshot();
      send(
        res,
        200,
        buildSummary(main, {
          dataDir,
          modules: state.modules,
          modulesSource: state.source,
          autoInject: state.auto_inject,
          inject: state.inject,
        }),
      );
    } catch (err) {
      send(res, 503, { error: 'summary_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}

export { readUiConfig, resolveModulesDetail, writeUiConfig };
