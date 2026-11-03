/**
 * Core gate facade. The single merge/persistence source is ui-config.mjs;
 * this file must never re-implement it.
 */
export {
  DEFAULT_MODULES,
  MODULE_KEYS,
  moduleEnabled,
  readUiConfig,
  resolveModules,
  resolveModulesDetail,
  writeUiConfig,
} from './ui-config.mjs';

import { resolveModulesDetail } from './ui-config.mjs';

/** Resolve the effective gate set for one plugin instance. */
export function modulesFor({ dataDir = null, config = null, logger = console } = {}) {
  return resolveModulesDetail({ dataDir, profileConfig: config, logger }).modules;
}
