/**
 * Host-authoritative runtime identity. Identity comes only from the caller's
 * ToolExecution (`exec`); any identity field in model args is a violation.
 * Offline handlers without exec.agent never get a fabricated identity.
 */
import { MODEL_AUTHOR_ROLES } from '../write/authority.mjs';

const RUNTIME_ROLE = Object.freeze({ record: 'daily', dream_record: 'dream', organize: 'dream' });
const FORBIDDEN = ['identity', 'sessionId', 'session_id', 'callId', 'call_id', 'agentId', 'agent_id', 'role', 'turn'];

export function runtimeFromExec({ exec = null, ctx = null, tool = null, role = null, args = {} } = {}) {
  const violations = FORBIDDEN.filter((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field));
  if (violations.length > 0) {
    return {
      ok: false,
      code: 'validation_error',
      field: violations[0],
      reason: 'runtime_identity_from_caller_only',
      violations,
    };
  }
  const mappedRole = role ?? RUNTIME_ROLE[tool] ?? null;
  if (!MODEL_AUTHOR_ROLES.includes(mappedRole)) {
    return { ok: false, code: 'invalid_role', role: mappedRole };
  }
  const agent = exec?.agent ?? null;
  const session = agent?.session ?? null;
  const header = session?.header ?? null;
  const callId = exec?.callId ?? null;
  if (!agent || !session || typeof header?.id !== 'string' || typeof callId !== 'string') {
    return { ok: false, code: 'runtime_identity_unavailable' };
  }
  let turn = null;
  try {
    turn = ctx?.sessionProjections?.stateOf?.(session, 'turnBoundary')?.lastTurn ?? null;
  } catch {
    turn = null;
  }
  const messageSeq =
    header.lastSeq ?? header.lastEventSeq ?? exec?.seq ?? exec?.messageSeq ?? null;
  return {
    ok: true,
    runtime: {
      role: mappedRole,
      identity: agent.id ?? 'model',
      agentId: agent.id ?? '',
      sessionId: header.id,
      callId,
      turn,
      messageSeq,
    },
  };
}
