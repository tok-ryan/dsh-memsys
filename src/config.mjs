import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECTION_NAME = 'memsys:context';
export const SECTION_ORDER = 500;
/** The persona section always assembles before the memory section (400 < 500). */
export const PERSONA_SECTION_NAME = 'memsys:persona';
export const PERSONA_SECTION_ORDER = 400;
/** Default cap for the persona text that reaches the system prompt. */
export const PERSONA_MAX_CHARS = 3000;

/** Canonical data directory below the user home: `~/.dsh/memsys`. */
export const DATA_DIR_PARTS = Object.freeze(['.dsh', 'memsys']);

const DEFAULTS = Object.freeze({
  busyTimeoutMs: 5000,
  synchronous: 'FULL',
  softBudgetCodePoints: 3200,
  maxCharsDefault: 8000,
  maxCharsMin: 1000,
  maxCharsMax: 16000,
  initialStrengthPolicy: 'initial-v1',
  autoInject: false,
  snapshotRetentionDays: 30,
  personaMaxChars: PERSONA_MAX_CHARS,
  personaSection: true,
});

/** `~/.dsh/memsys` — the one canonical data directory. */
export function defaultDataDir(home = os.homedir()) {
  return path.join(home, ...DATA_DIR_PARTS);
}

/**
 * The single place that decides where memsys data lives.
 *
 * Priority: trusted explicit override (tests, CLI, embedders) > the
 * `MEMSYS_DATA_DIR` process override (probes) > the canonical
 * `~/.dsh/memsys`. Nothing else may invent a data directory.
 *
 * A profile `data_dir` is deprecated in 0.3.0; callers that still pass one keep
 * working for one release while `scripts/migrate-datadir.mjs` moves it.
 */
export function resolveDataDir(overrides = {}) {
  const explicit = overrides.dataDir ?? overrides.data_dir;
  if (explicit !== undefined && explicit !== null) {
    if (typeof explicit !== 'string' || explicit.trim().length === 0) {
      throw new TypeError('invalid_data_dir');
    }
    return path.resolve(explicit);
  }
  const envDir = overrides.env?.MEMSYS_DATA_DIR ?? process.env.MEMSYS_DATA_DIR;
  if (typeof envDir === 'string' && envDir.trim().length > 0) return path.resolve(envDir);
  return defaultDataDir();
}

/**
 * Resolve the controlled startup configuration. The model can never choose a
 * database or directory; only a trusted startup caller may pass `dataDir`.
 */
export function resolveConfig(overrides = {}) {
  if (overrides.dataDir !== undefined) {
    if (typeof overrides.dataDir !== 'string' || overrides.dataDir.length === 0) {
      throw new TypeError('invalid_data_dir');
    }
  }
  const dataDir = resolveDataDir({
    dataDir: overrides.dataDir,
    data_dir: overrides.data_dir,
    env: overrides.env,
  });

  const mode = overrides.mode ?? null;
  if (mode !== null && mode !== 'work' && mode !== 'life') {
    throw new TypeError('invalid_mode');
  }

  return Object.freeze({
    ...DEFAULTS,
    ...overrides,
    dataDir,
    mode,
    autoInject: overrides.autoInject ?? DEFAULTS.autoInject,
    personaMaxChars: overrides.personaMaxChars ?? PERSONA_MAX_CHARS,
    personaSection: overrides.personaSection !== false,
    injectionSection: Object.freeze({ name: SECTION_NAME, order: SECTION_ORDER }),
    personaInjectionSection: Object.freeze({
      name: PERSONA_SECTION_NAME,
      order: PERSONA_SECTION_ORDER,
    }),
    dbPaths: Object.freeze({
      main: path.join(dataDir, 'memsys.db'),
      control: path.join(dataDir, 'control.db'),
      dream: path.join(dataDir, 'dreams.db'),
      backup: path.join(dataDir, 'backup'),
    }),
    personaDir: path.join(dataDir, 'persona'),
  });
}

export function ensureDataDirs(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.dbPaths.backup, { recursive: true });
  return config;
}

/** Batch-1 fixed policy switches that must never be flipped by a model. */
export const BATCH1_POLICY = Object.freeze({
  allowAutoInject: false,
  allowOwnerActions: false,
  allowSupersedeWrite: false,
  allowRekey: false,
  allowOpenDue: false,
  maxScenes: ['work', 'life'],
  sectionName: SECTION_NAME,
  sectionOrder: SECTION_ORDER,
  personaSectionName: PERSONA_SECTION_NAME,
  personaSectionOrder: PERSONA_SECTION_ORDER,
});
