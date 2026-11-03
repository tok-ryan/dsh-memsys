/**
 * Session event log adapter. Round identity comes from `session/event` payload
 * logs, never from the plugin bus: `ctx.on('assistant/message')` never fires.
 */
export function normalizeLog(log = []) {
  if (!Array.isArray(log)) return [];
  return log.map((event) => ({
    seq: Number(event.seq ?? 0),
    type: event.type,
    payload: event.payload ?? event,
  }));
}

export function createEventCursor() {
  let lastSeq = 0;
  return {
    lastSeq() {
      return lastSeq;
    },
    consume(log) {
      const events = normalizeLog(log).filter((event) => event.seq > lastSeq);
      if (events.length > 0) lastSeq = Math.max(...events.map((event) => event.seq));
      return events;
    },
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function extractInputText(event) {
  const payload = event?.payload ?? {};
  return firstString(
    payload.text,
    payload.content,
    payload.prompt,
    payload.message?.text,
    payload.message?.content,
    typeof payload.message === 'string' ? payload.message : null,
  );
}

export function extractUserInputs(events) {
  const inputs = [];
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue;
    const text = extractInputText(event);
    if (text === null) continue;
    const messageSeq =
      event.payload?.message?.id ?? event.payload?.messageId ?? event.payload?.seq ?? event.seq;
    inputs.push({ text, messageSeq, seq: event.seq });
  }
  return inputs;
}

export function extractTurnInfo(events) {
  let turn = null;
  let step = null;
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === 'turn/start' && payload.turn !== undefined) turn = Number(payload.turn);
    if (event.type === 'step/start' && payload.step !== undefined) step = Number(payload.step);
  }
  return { turn, step };
}

export function extractAssistantOutput(events) {
  let output = null;
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const text = extractInputText(event);
    if (text !== null) output = text;
  }
  return output;
}

/** Round descriptor used by compile; multiple steps never open a new round. */
export function roundOf(events, sessionId) {
  const { turn } = extractTurnInfo(events);
  return {
    sessionId,
    turn: turn ?? 0,
    roundId: `${sessionId}:${turn ?? 0}`,
    inputs: extractUserInputs(events),
    output: extractAssistantOutput(events),
    hasTurnEnd: events.some((event) => event.type === 'turn/end'),
  };
}
