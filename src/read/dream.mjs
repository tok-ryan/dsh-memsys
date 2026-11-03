import { dreamStatus } from '../dream/replay.mjs';

/** Read-only dream view: original text, propositions, candidates and history. */
export function dreamGet({ dream, clock, dreamId }) {
  const status = dreamStatus(dream, dreamId);
  if (!status) return { status: 'error', code: 'dream_missing', clock: clock.at().at };
  return {
    status: 'ok',
    dreamId,
    voided: status.voided,
    dream: status.dream,
    propositions: status.propositions,
    candidates: status.candidates,
    clock: clock.at().at,
  };
}

export function dreamReviewList({ dream, clock }) {
  const dreams = dream
    .prepare("SELECT id FROM dreams ORDER BY at ASC, id ASC")
    .all()
    .map((row) => dreamStatus(dream, row.id))
    .filter(Boolean);
  return {
    status: 'ok',
    items: dreams.map((entry) => ({
      dreamId: entry.dream.id,
      idea: entry.dream.idea,
      voided: entry.voided,
      propositions: entry.propositions.map((proposition) => ({
        id: proposition.id,
        text: proposition.text,
        textHash: proposition.text_hash,
        confirmed: Boolean(proposition.confirmation?.valid),
      })),
    })),
    clock: clock.at().at,
  };
}
