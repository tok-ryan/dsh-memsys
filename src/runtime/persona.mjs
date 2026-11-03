/**
 * Versioned persona store (0.3.0).
 *
 * The package ships a read-only seed at `persona/v1.md`. Owner edits are written
 * to `<dataDir>/persona/vN.md` as *new* files, so the version history is the
 * directory itself and an older version can never be overwritten. Reads prefer
 * the highest version number across the owner directory and the packaged seed.
 *
 * Only the owner channel may write: the settings-page route builds the caller
 * from the trusted loopback+same-origin request, never from the request body,
 * and `assertOwnerRuntime` (src/write/authority.mjs) rejects everything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERSONA_MAX_CHARS } from '../config.mjs';
import { WriteError, assertNoForbiddenFields, assertOwnerRuntime } from '../write/authority.mjs';
import { isLoopback, sameOrigin } from './summary.mjs';

export const PERSONA_VERSION_RE = /^v(\d+)\.md$/;
/** Owner edits land in `<dataDir>/persona/`. */
export const PERSONA_DIR_NAME = 'persona';
export const PERSONA_SAVE_MAX_CHARS = 20000;
export const PERSONA_BODY_LIMIT = 128 * 1024;
/** Seed directory inside the package: `<package>/persona`. */
export const PACKAGED_PERSONA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'persona',
);

/** `v12.md` → 12; anything that is not a version file → null. */
export function parseVersionFile(name) {
  const match = PERSONA_VERSION_RE.exec(String(name ?? ''));
  return match ? Number(match[1]) : null;
}

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * One directory's versions, newest first. Unreadable/missing directories are
 * empty, never a thrown boot error.
 */
export function listVersionDir(dir) {
  if (!dir) return [];
  return readDir(dir)
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, version: parseVersionFile(entry.name) }))
    .filter((item) => Number.isInteger(item.version))
    .map(({ entry, version }) => {
      const file = path.join(dir, entry.name);
      const stat = statSafe(file);
      return {
        version,
        file,
        bytes: stat?.size ?? null,
        at: stat ? new Date(stat.mtimeMs).toISOString() : null,
        source: 'data',
      };
    })
    .sort((a, b) => b.version - a.version);
}

/**
 * The merged history: owner directory first, packaged seed only for versions the
 * owner directory does not already carry (owner wins a tie).
 */
export function listVersions({ dataDir = null, packagedDir = PACKAGED_PERSONA_DIR } = {}) {
  const ownerDir = dataDir ? path.join(dataDir, PERSONA_DIR_NAME) : null;
  const owner = listVersionDir(ownerDir);
  const seen = new Set(owner.map((item) => item.version));
  const packaged = listVersionDir(packagedDir)
    .filter((item) => !seen.has(item.version))
    .map((item) => ({ ...item, source: 'packaged' }));
  return [...owner, ...packaged].sort((a, b) => b.version - a.version);
}

/**
 * A persona store bound to one data directory. `packagedDir` is injectable so
 * tests never depend on the repository layout.
 */
export function createPersonaStore({
  dataDir = null,
  packagedDir = PACKAGED_PERSONA_DIR,
  maxChars = PERSONA_MAX_CHARS,
  clock = null,
  logger = console,
} = {}) {
  const dataPersonaDir = dataDir ? path.join(dataDir, PERSONA_DIR_NAME) : null;
  const textCache = new Map(); // file -> { key, text }

  const warn = (message) => {
    try {
      logger?.warn?.(`[dsh-memsys] ${message}`);
    } catch {
      // a logger that throws must never break the persona section
    }
  };

  const versions = () => listVersions({ dataDir, packagedDir });

  const readEntry = (entry) => {
    const stat = statSafe(entry.file);
    const key = stat ? `${stat.mtimeMs}:${stat.size}` : 'missing';
    const cached = textCache.get(entry.file);
    if (cached && cached.key === key) {
      return { version: entry.version, text: cached.text, source: entry.source, file: entry.file };
    }
    try {
      const text = fs.readFileSync(entry.file, 'utf8');
      textCache.set(entry.file, { key, text });
      return { version: entry.version, text, source: entry.source, file: entry.file };
    } catch (err) {
      warn(`人格版本读取失败（${entry.file}：${err?.message ?? err}）`);
      return null;
    }
  };

  const current = () => {
    const entry = versions()[0];
    if (!entry) return null;
    const read = readEntry(entry);
    if (!read) return null;
    return { version: read.version, text: read.text, source: read.source };
  };

  const readVersion = (version) => {
    const wanted = Number(version);
    if (!Number.isInteger(wanted) || wanted <= 0) return null;
    const entry = versions().find((item) => item.version === wanted);
    return entry ? readEntry(entry) : null;
  };

  const sectionText = () => {
    const currentEntry = current();
    const text = currentEntry?.text ?? null;
    if (text === null) return null;
    const max = Math.max(1, Number(maxChars) || PERSONA_MAX_CHARS);
    const chars = Array.from(text);
    if (chars.length <= max) return text;
    return `${chars.slice(0, max).join('')}\n…（人格过长已截断，完整版 v${currentEntry.version}）`;
  };

  /**
   * Append a new version. Never rewrites an existing file, so the history is
   * append-only even when two saves happen in a row.
   */
  const save = ({ text, caller, at = null } = {}) => {
    assertOwnerRuntime(caller);
    if (!dataPersonaDir) throw new WriteError('data_dir_missing');
    if (typeof text !== 'string') throw new WriteError('validation_error', { field: 'text' });
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (normalized.length === 0) {
      throw new WriteError('validation_error', { field: 'text', reason: 'empty' });
    }
    if (Array.from(normalized).length > PERSONA_SAVE_MAX_CHARS) {
      throw new WriteError('validation_error', { field: 'text', reason: 'too_long', max: PERSONA_SAVE_MAX_CHARS });
    }
    const next = (versions()[0]?.version ?? 0) + 1;
    const file = path.join(dataPersonaDir, `v${next}.md`);
    fs.mkdirSync(dataPersonaDir, { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${normalized}\n`, 'utf8');
    try {
      fs.renameSync(temp, file);
    } catch (err) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // preserve the original error
      }
      throw err;
    }
    textCache.delete(file);
    const atValue = at ?? clock?.at?.().at ?? new Date().toISOString();
    return { version: next, file, at: atValue };
  };

  return {
    dataDir,
    dataPersonaDir,
    versions,
    current,
    readVersion,
    sectionText,
    save,
    invalidate: () => textCache.clear(),
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readVersionParam(url) {
  const raw = String(url ?? '');
  const index = raw.indexOf('?');
  if (index < 0) return null;
  const params = new URLSearchParams(raw.slice(index + 1));
  const version = params.get('version');
  return version === null || version === '' ? null : Number(version);
}

/**
 * Owner channel for the settings page. The caller object is constructed *here*,
 * after the loopback + same-origin gates, so a request body can never claim a
 * role. A host that has a better auth story may inject `resolveCaller`, and a
 * non-owner caller is rejected by `store.save` with `invalid_role`.
 */
export function createPersonaHandler({
  store,
  resolveCaller = null,
  logger = console,
  onSaved = null,
} = {}) {
  if (!store) throw new TypeError('persona_store_required');
  const callerFor = resolveCaller ?? (() => Object.freeze({ role: 'owner', channel: 'settings-page' }));

  return (req, res) => {
    if (!isLoopback(req) || !sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    const method = req.method ?? 'GET';
    if (method === 'GET') {
      try {
        const wanted = readVersionParam(req.url);
        if (wanted !== null) {
          const entry = store.readVersion(wanted);
          if (!entry) {
            sendJson(res, 404, { error: 'version_not_found', version: wanted });
            return;
          }
          sendJson(res, 200, { version: entry.version, text: entry.text, source: entry.source });
          return;
        }
        const current = store.current();
        sendJson(res, 200, {
          version: current?.version ?? null,
          text: current?.text ?? null,
          source: current?.source ?? null,
          versions: store.versions().map(({ version, bytes, at, source }) => ({ version, bytes, at, source })),
        });
      } catch (err) {
        logger?.warn?.(`[dsh-memsys] persona read failed: ${err?.message ?? err}`);
        sendJson(res, 500, { error: 'read_failed', message: String(err?.code ?? err?.message ?? err) });
      }
      return;
    }
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const type = String(req.headers?.['content-type'] ?? '').toLowerCase();
    if (!type.includes('application/json')) {
      sendJson(res, 415, { error: 'json_required' });
      return;
    }
    let body = '';
    let tooLarge = false;
    req.on?.('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > PERSONA_BODY_LIMIT) tooLarge = true;
    });
    req.on?.('end', () => {
      if (tooLarge) {
        sendJson(res, 413, { error: 'body_too_large' });
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      try {
        // The same forbidden-field vocabulary the write path uses; a body may
        // only carry the persona text.
        assertNoForbiddenFields(parsed);
      } catch (err) {
        sendJson(res, 400, { error: 'validation_error', code: err?.code ?? 'validation_error' });
        return;
      }
      const unknown = Object.keys(parsed).filter((key) => key !== 'text');
      if (unknown.length > 0) {
        sendJson(res, 400, { error: 'unknown_field', fields: unknown });
        return;
      }
      try {
        const saved = store.save({ text: parsed.text, caller: callerFor(req) });
        try {
          onSaved?.(saved);
        } catch {
          // a refresh failure must not make a committed save look failed
        }
        sendJson(res, 200, { ok: true, version: saved.version, at: saved.at });
      } catch (err) {
        if (err instanceof WriteError && err.code === 'invalid_role') {
          sendJson(res, 403, { error: 'forbidden', code: 'invalid_role', role: err.detail?.role ?? null });
          return;
        }
        if (err instanceof WriteError) {
          sendJson(res, 400, { error: 'validation_error', code: err.code, detail: err.detail ?? {} });
          return;
        }
        logger?.warn?.(`[dsh-memsys] persona save failed: ${err?.message ?? err}`);
        sendJson(res, 500, { error: 'write_failed', message: String(err?.message ?? err) });
      }
    });
  };
}
