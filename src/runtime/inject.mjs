import fs from 'node:fs';

export const SECTION_NAME = 'memsys:context';
export const SECTION_ORDER = 500;

/**
 * The only verified injection call shape (probe-p0):
 *   ctx.inject(['systemPrompt'], c => c.systemPrompt.section({name, order, text}))
 * Static `export const inject` would leave the plugin pending forever.
 *
 * `dynamicText: true` registers the resolver itself so the host re-reads it per
 * assembly; the default keeps the historical one-shot string.
 */
export function registerSection(
  ctx,
  { getText, name = SECTION_NAME, order = SECTION_ORDER, diagnosticMarker = null, dynamicText = false } = {},
) {
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
    const resolve = () => (typeof getText === 'function' ? getText() : String(getText ?? ''));
    // Dynamic text stays a function: the host re-evaluates it on every
    // `systemPrompt.assemble()`, i.e. once per model step (verified on a probe
    // profile: two assemblies produced probe-1 then probe-2). A static string
    // would freeze the first round forever.
    const text = dynamicText ? resolve : resolve();
    // `name`/`order` default to the historical memory section, so the persona
    // section can reuse the same verified call shape without a second copy.
    c.systemPrompt.section({ name, order, text });
    if (diagnosticMarker) {
      fs.writeFileSync(
        diagnosticMarker,
        JSON.stringify(
          {
            name,
            order,
            text_length: String(resolve()).length,
            dynamic: dynamicText === true,
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
