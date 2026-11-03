/**
 * Host side of the optional Web UI (sidebar panel + settings section).
 *
 * Everything here is read-only over SQLite plus one small JSON file holding the
 * `auto_inject` override written by the settings switch. Both routes enforce
 * loopback + same-origin before touching data; nothing here is model-facing.
 */
import fs from 'node:fs';
import path from 'node:path';

const UI_CONFIG_FILE = 'ui-config.json';
const UI_CONFIG_VERSION = 1;
const RECENT_LIMIT = 5;
const TEXT_LIMIT = 80;
const BODY_LIMIT = 4096;

const warn = (logger, message) => {
  try {
    logger?.warn?.(`[dsh-memsys] ${message}`);
  } catch {
    // a logger that throws must never break boot
  }
};

/**
 * Read the settings file written by the Web switch.
 * Returns `{ auto_inject }` or `null` when absent. A corrupt or foreign-version
 * file is ignored with one warning: a bad file must never stop the plugin.
 */
export function readUiConfig(dataDir, logger = console) {
  if (!dataDir) return null;
  const file = path.join(dataDir, UI_CONFIG_FILE);
  let raw = null;
  try {
    if (!fs.existsSync(file)) return null;
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    warn(logger, `ui-config 读取失败（${err?.message ?? err}），回落 profile 配置`);
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(logger, 'ui-config 不是合法 JSON，回落 profile 配置');
    return null;
  }
  if (parsed?.version !== UI_CONFIG_VERSION) {
    warn(logger, `ui-config 版本不符（${parsed?.version ?? 'none'}，期望 ${UI_CONFIG_VERSION}），已忽略`);
    return null;
  }
  if (typeof parsed?.auto_inject !== 'boolean') {
    warn(logger, 'ui-config 缺少 auto_inject 布尔值，已忽略');
    return null;
  }
  return { auto_inject: parsed.auto_inject };
}

/**
 * Priority: ui-config.json (when present and valid) > profile patch value > false.
 * The reported `source` is what the Web page shows next to the switch.
 */
export function resolveAutoInject({ dataDir = null, profileValue = undefined, logger = console } = {}) {
  const stored = readUiConfig(dataDir, logger);
  if (stored !== null) return { value: stored.auto_inject, source: 'ui-config' };
  if (typeof profileValue === 'boolean') return { value: profileValue, source: 'profile' };
  return { value: false, source: 'default' };
}

/** Write-through with a temp file so a crash never leaves half a config. */
export function writeUiConfig(dataDir, autoInject) {
  if (!dataDir) return false;
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, UI_CONFIG_FILE);
  const temp = `${target}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({ version: UI_CONFIG_VERSION, auto_inject: autoInject === true }, null, 2),
    'utf8',
  );
  fs.renameSync(temp, target);
  return true;
}

const truncate = (text) => Array.from(String(text ?? '')).slice(0, TEXT_LIMIT).join('');

/** Three counts plus the five latest memories; `candidates` means still-open ones. */
export function buildSummary(main, { dataDir = null, autoInject = false, autoInjectSource = 'default' } = {}) {
  const db = typeof main === 'function' ? main() : main;
  const one = (sql, ...params) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const recent = db
    .prepare('SELECT id, text FROM memories ORDER BY recorded_at DESC, id DESC LIMIT ?')
    .all(RECENT_LIMIT)
    .map((row) => ({ id: row.id, text: truncate(row.text) }));
  return {
    memories: one('SELECT COUNT(*) AS n FROM memories'),
    candidates: one("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('pending', 'conflicted')"),
    pending_due: one("SELECT COUNT(*) AS n FROM memories WHERE due_state = 'pending-due'"),
    recent,
    data_dir: dataDir,
    auto_inject: autoInject === true,
    auto_inject_source: autoInjectSource,
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
  getAutoInject = () => false,
  onAutoInject = null,
} = {}) {
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
        if (typeof parsed?.auto_inject !== 'boolean') {
          send(res, 400, { error: 'auto_inject_required' });
          return;
        }
        try {
          onAutoInject?.(parsed.auto_inject);
          send(res, 200, { ok: true, auto_inject: parsed.auto_inject, auto_inject_source: 'ui-config' });
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
      const current = getAutoInject();
      const value = typeof current === 'boolean' ? current : current?.value === true;
      const source = typeof current === 'boolean' ? 'ui-config' : (current?.source ?? 'default');
      send(res, 200, buildSummary(main, { dataDir, autoInject: value, autoInjectSource: source }));
    } catch (err) {
      send(res, 503, { error: 'summary_unavailable', message: String(err?.code ?? err?.message ?? err) });
    }
  };
}
