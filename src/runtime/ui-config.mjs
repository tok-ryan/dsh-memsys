/**
 * The single source of truth for module switches.
 *
 * Both halves read this file: the Web data route (`src/runtime/summary.mjs`) and
 * the host-side gates (`src/runtime/modules.mjs` re-exports from here). Nothing
 * else may re-implement the merge — a second copy is how the switch becomes a
 * lie.
 *
 * Priority: `<data_dir>/ui-config.json` > profile patch config > default (true).
 */
import fs from 'node:fs';
import path from 'node:path';

export const UI_CONFIG_FILE = 'ui-config.json';
export const UI_CONFIG_VERSION = 2;
export const MODULE_KEYS = Object.freeze(['context', 'read', 'write', 'dream', 'projects', 'due', 'feed']);
export const DEFAULT_MODULES = Object.freeze({
  context: true,
  read: true,
  write: true,
  dream: true,
  projects: true,
  due: true,
  feed: true,
});

const warn = (logger, message) => {
  try {
    logger?.warn?.(`[dsh-memsys] ${message}`);
  } catch {
    // a logger that throws must never break boot
  }
};

/** Missing keys mean `true`; only an explicit `false` disables a module. */
export function normalizeModules(input = {}) {
  const modules = { ...DEFAULT_MODULES };
  if (input && typeof input === 'object') {
    for (const key of MODULE_KEYS) {
      if (typeof input[key] === 'boolean') modules[key] = input[key];
    }
  }
  return modules;
}

/**
 * v2 is `{ version: 2, auto_inject, modules }`.
 * v1 (or versionless) files only carry `auto_inject`; they migrate by mapping it
 * onto `modules.context` while every other module stays on.
 */
export function normalizeUiConfig(parsed, logger = console) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const version = parsed.version;
  const known = version === undefined || version === 1 || version === UI_CONFIG_VERSION;
  if (!known) {
    warn(logger, `ui-config 版本不认识（${version}），已忽略`);
    return null;
  }
  const hasModules = parsed.modules && typeof parsed.modules === 'object';
  if (version === undefined && typeof parsed.auto_inject !== 'boolean' && !hasModules) {
    warn(logger, 'ui-config 既无 auto_inject 也无 modules，已忽略');
    return null;
  }
  const modules = normalizeModules(hasModules ? parsed.modules : {});
  if (!hasModules && typeof parsed.auto_inject === 'boolean') modules.context = parsed.auto_inject;
  return {
    version: UI_CONFIG_VERSION,
    auto_inject: modules.context,
    modules,
  };
}

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
  try {
    return normalizeUiConfig(JSON.parse(raw), logger);
  } catch {
    warn(logger, 'ui-config 不是合法 JSON，回落 profile 配置');
    return null;
  }
}

/**
 * Pure merge used by every caller: defaults <- profile config <- ui-config.
 * A legacy `auto_inject` fills `modules.context` only when that source says
 * nothing about `modules` at all.
 */
export function mergeModules(profileConfig = null, uiConfig = null) {
  const base = { ...DEFAULT_MODULES };
  const apply = (source) => {
    if (!source || typeof source !== 'object') return;
    const modules = source.modules;
    if (modules && typeof modules === 'object') {
      for (const key of MODULE_KEYS) {
        if (typeof modules[key] === 'boolean') base[key] = modules[key];
      }
    }
    if (typeof source.auto_inject === 'boolean' && modules?.context === undefined) {
      base.context = source.auto_inject;
    }
  };
  apply(profileConfig);
  apply(uiConfig);
  return base;
}

/** Kept under the name the host gates already import. */
export function resolveModules(profileConfig = null, uiConfig = null) {
  return Object.freeze(mergeModules(profileConfig, uiConfig));
}

export function moduleEnabled(modules, key) {
  return (modules ?? DEFAULT_MODULES)[key] !== false;
}

const profileSaysSomething = (profileConfig) =>
  Boolean(
    profileConfig &&
      (profileConfig.modules && typeof profileConfig.modules === 'object'
        ? MODULE_KEYS.some((key) => typeof profileConfig.modules[key] === 'boolean')
        : typeof profileConfig.auto_inject === 'boolean'),
  );

/**
 * Resolve for the Web route: returns the effective map plus which rank won,
 * so the settings page can show where the value came from.
 */
export function resolveModulesDetail({ dataDir = null, profileConfig = null, logger = console } = {}) {
  const stored = readUiConfig(dataDir, logger);
  const modules = mergeModules(profileConfig, stored);
  const source = stored ? 'ui-config' : profileSaysSomething(profileConfig) ? 'profile' : 'default';
  return { modules, source, auto_inject: modules.context };
}

/**
 * Partial update: sends only the keys it owns. A legacy `auto_inject` maps onto
 * `modules.context`; sending `modules.context` mirrors back into `auto_inject`
 * so v1 readers keep working.
 */
export function writeUiConfig(dataDir, patch = {}, logger = console) {
  if (!dataDir) return null;
  const current = readUiConfig(dataDir, logger) ?? {
    version: UI_CONFIG_VERSION,
    auto_inject: DEFAULT_MODULES.context,
    modules: { ...DEFAULT_MODULES },
  };
  const next = { ...current.modules };
  if (patch.modules && typeof patch.modules === 'object') {
    for (const key of MODULE_KEYS) {
      if (typeof patch.modules[key] === 'boolean') next[key] = patch.modules[key];
    }
  }
  if (typeof patch.auto_inject === 'boolean' && patch.modules?.context === undefined) {
    next.context = patch.auto_inject;
  }
  const normalized = {
    version: UI_CONFIG_VERSION,
    auto_inject: next.context,
    modules: next,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, UI_CONFIG_FILE);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(temp, target);
  return normalized;
}
