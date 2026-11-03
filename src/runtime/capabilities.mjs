/**
 * Capability gate. Unknown never counts as passed, and the organ only claims
 * automatic delivery when the budget and receipt guarantees are verified.
 */
export const CAPABILITY_NAMES = Object.freeze([
  'inject_section',
  'session_event_log',
  'per_round_update',
  'budget_tokenizer',
  'delivery_receipt',
  'tool_registration',
  'multi_session_isolation',
]);

export function emptyReport({ hostVersion = 'unknown', pluginVersion = '0.1.0' } = {}) {
  const capabilities = {};
  for (const name of CAPABILITY_NAMES) {
    capabilities[name] = { status: 'unknown', evidence: null, alternative: null, checkedAt: null };
  }
  return { hostVersion, pluginVersion, capabilities };
}

export function recordCapability(report, name, { status, evidence = null, alternative = null } = {}) {
  if (!CAPABILITY_NAMES.includes(name)) throw new TypeError(`unknown_capability:${name}`);
  if (!['passed', 'failed', 'unknown'].includes(status)) throw new TypeError(`invalid_status:${status}`);
  return {
    ...report,
    capabilities: {
      ...report.capabilities,
      [name]: { status, evidence, alternative, checkedAt: new Date().toISOString() },
    },
  };
}

/** Host upgrade invalidates prior passed evidence. */
export function invalidateOnHostChange(report, currentHostVersion) {
  if (report.hostVersion === currentHostVersion) return report;
  const capabilities = {};
  for (const [name, entry] of Object.entries(report.capabilities)) {
    capabilities[name] =
      entry.status === 'passed'
        ? { ...entry, status: 'unknown', evidence: null, checkedAt: null }
        : entry;
  }
  return { ...report, hostVersion: currentHostVersion, capabilities };
}

/**
 * Production mode: auto only when auto-inject is enabled AND a verified
 * tokenizer and host H exist AND a receipt path is available. Otherwise tools.
 */
export function injectionMode({ autoInject = false, tokenizer = null, H = null, receipt = false } = {}) {
  if (!autoInject) return { mode: 'tools-only', reason: 'auto_inject_disabled' };
  if (!tokenizer) return { mode: 'tools-only', reason: 'budget_unverified' };
  if (H === null || H === undefined) return { mode: 'tools-only', reason: 'host_budget_unknown' };
  if (!receipt) return { mode: 'tools-only', reason: 'delivery_receipt_missing' };
  return { mode: 'auto', reason: null };
}
