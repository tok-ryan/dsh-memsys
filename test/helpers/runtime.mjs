export const TEST_IDENTITY = 'test-owner';
export const TEST_SESSION = 'test-session';

/** Trusted fake runtime: identity/role/mode never come from model parameters. */
export function fakeRuntime(overrides = {}) {
  return Object.freeze({
    identity: TEST_IDENTITY,
    role: 'daily',
    phase: 'work',
    mode: 'work',
    sessionId: TEST_SESSION,
    roundId: '1',
    messageSeq: 1,
    activeProjectId: null,
    ...overrides,
  });
}

/** Replay a minimal session/event log slice (batch-1 anchor shape). */
export function sessionEventLog(events = []) {
  return events.map((event, index) => ({
    seq: event.seq ?? index + 1,
    type: event.type,
    ...event,
  }));
}
