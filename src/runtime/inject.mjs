import fs from 'node:fs';

export const SECTION_NAME = 'memsys:context';
export const SECTION_ORDER = 500;

/**
 * The only verified injection call shape (probe-p0):
 *   ctx.inject(['systemPrompt'], c => c.systemPrompt.section({name, order, text}))
 * Static `export const inject` would leave the plugin pending forever.
 */
export function registerSection(ctx, { getText, diagnosticMarker = null } = {}) {
  if (!ctx || typeof ctx.inject !== 'function') {
    const err = new Error('invalid_ctx');
    err.code = 'invalid_ctx';
    throw err;
  }
  const disposer = ctx.inject(['systemPrompt'], (c) => {
    if (!c || !c.systemPrompt || typeof c.systemPrompt.section !== 'function') {
      const err = new Error('system_prompt_unavailable');
      err.code = 'system_prompt_unavailable';
      throw err;
    }
    const text = typeof getText === 'function' ? getText() : String(getText ?? '');
    c.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text });
    if (diagnosticMarker) {
      fs.writeFileSync(
        diagnosticMarker,
        JSON.stringify(
          {
            name: SECTION_NAME,
            order: SECTION_ORDER,
            text_length: String(text).length,
            registered_at: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
    }
  });
  return typeof disposer === 'function' ? disposer : () => {};
}

/** Offline fake ctx used by tests; mirrors the verified call shape. */
export function createFakeCtx() {
  const calls = [];
  let disposed = false;
  return {
    calls,
    isDisposed: () => disposed,
    inject(services, callback) {
      calls.push({ services: [...services] });
      const systemPrompt = {
        section(section) {
          calls.push({ section });
        },
      };
      callback({ systemPrompt });
      return () => {
        disposed = true;
      };
    },
  };
}
