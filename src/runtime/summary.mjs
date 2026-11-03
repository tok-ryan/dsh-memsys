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

const RECENT_LIMIT = 5;
const TEXT_LIMIT = 80;
const BODY_LIMIT = 4096;

const truncate = (text) => Array.from(String(text ?? '')).slice(0, TEXT_LIMIT).join('');

/** Three counts, the five latest memories, and the effective module map. */
export function buildSummary(
  main,
  { dataDir = null, modules = DEFAULT_MODULES, modulesSource = 'default', autoInject = undefined } = {},
) {
  const db = typeof main === 'function' ? main() : main;
  const one = (sql, ...params) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const recent = db
    .prepare('SELECT id, text FROM memories ORDER BY recorded_at DESC, id DESC LIMIT ?')
    .all(RECENT_LIMIT)
    .map((row) => ({ id: row.id, text: truncate(row.text) }));
  const effective = {};
  for (const key of MODULE_KEYS) effective[key] = modules?.[key] !== false;
  return {
    memories: one('SELECT COUNT(*) AS n FROM memories'),
    candidates: one("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('pending', 'conflicted')"),
    pending_due: one("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'pending-due'"),
    recent,
    data_dir: dataDir,
    auto_inject: autoInject === undefined ? effective.context : autoInject === true,
    auto_inject_source: modulesSource,
    modules: effective,
    modules_source: modulesSource,
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
        }),
      );
    } catch (err) {
      send(res, 503, { error: 'summary_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}

export { readUiConfig, resolveModulesDetail, writeUiConfig };
