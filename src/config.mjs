import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECTION_NAME = 'memsys:context';
export const SECTION_ORDER = 500;

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
});

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
  const dataDir = overrides.dataDir
    ? path.resolve(overrides.dataDir)
    : path.join(os.homedir(), '.dsh', 'memsys');

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
    injectionSection: Object.freeze({ name: SECTION_NAME, order: SECTION_ORDER }),
    dbPaths: Object.freeze({
      main: path.join(dataDir, 'memsys.db'),
      control: path.join(dataDir, 'control.db'),
      dream: path.join(dataDir, 'dreams.db'),
      backup: path.join(dataDir, 'backup'),
    }),
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
});
