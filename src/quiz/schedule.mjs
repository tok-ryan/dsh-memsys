/**
 * Quiz scheduler, ported from echo's pickEntry / dueScore (index.js:184-201),
 * with the two long-standing echo bugs fixed.
 *
 * Bug 1 — `level` was read but never written, so everything always came due
 * after 1 day and the 1/4/16/64/256 ladder never advanced. `nextLevel()` now
 * owns the transition: score >= 0.8 -> level + 1 (capped at 4);
 * score < 0.6 -> level 0; 0.6 <= score < 0.8 -> unchanged (D1).
 *
 * Bug 2 — `dueHours` was configured but never used by echo: no caller passed it
 * and no computation read it. DECISION (D2): it is deleted, NOT wired into
 * dueScore. Due-ness is already expressed by `INTERVALS[level]` days; adding an
 * hour threshold would judge the same thing twice and could keep an overdue item
 * out. `dueScore` therefore takes exactly `(entry, state, now)`.
 *
 * `state` mirrors a `quiz_state` row: { level, attempts, lastAt, lastScore,
 * bestScore } — i.e. quiz_state.last_at is read as `state.lastAt`.
 */

export const INTERVALS = Object.freeze([1, 4, 16, 64, 256]);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OVERDUE_DAYS = 30;
/** Echo's flat priority for an entry that has never been examined. */
const NEVER_EXAMINED = 3;
/** Score returned when the next interval has not elapsed yet: "not today". */
const NOT_DUE = -1;

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  throw new TypeError('invalid_due_time');
}

function clampLevel(level) {
  const value = Number(level);
  if (!Number.isFinite(value)) return 0;
  return Math.min(INTERVALS.length - 1, Math.max(0, Math.trunc(value)));
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Echo's dueScore, verbatim: never examined -> 3; before the interval elapses
 * -> -1; otherwise (1 + min(overdueDays, 30)) * (0.6 + weight), weight in
 * [0, 1] from entry.weight/100, or 1.6 when pinned.
 */
export function dueScore(entry, state, now) {
  if (!state || state.lastAt === null || state.lastAt === undefined) return NEVER_EXAMINED;
  const lastAt = Date.parse(state.lastAt);
  const nowMs = toMillis(now);
  if (!Number.isFinite(lastAt) || !Number.isFinite(nowMs)) throw new TypeError('invalid_due_time');
  const level = clampLevel(state.level);
  const dueAt = lastAt + INTERVALS[level] * DAY_MS;
  const overdueDays = (nowMs - dueAt) / DAY_MS;
  if (overdueDays < 0) return NOT_DUE;
  const weight = entry?.pinned ? 1.6 : clampUnit((Number(entry?.weight) || 0) / 100);
  return (1 + Math.min(overdueDays, MAX_OVERDUE_DAYS)) * (0.6 + weight);
}

/**
 * Level transition after one exam (D1). Input score is a 0..1 grade; levels
 * live in 0..INTERVALS.length-1.
 */
export function nextLevel(score, level) {
  if (typeof score !== 'number' || !Number.isFinite(score)) throw new TypeError('invalid_score');
  const current = clampLevel(level);
  const grade = clampUnit(score);
  if (grade < 0.6) return 0;
  if (grade >= 0.8) return Math.min(INTERVALS.length - 1, current + 1);
  return current;
}

/**
 * Pick the most overdue entry. Accepts a Map keyed by entry id or a plain
 * object; equal scores keep the first candidate (echo used a strict `>`).
 * Returns null when nothing is due.
 */
export function pickDue(candidates, stateMap, now) {
  let best = null;
  let bestScore = -1;
  for (const entry of candidates ?? []) {
    const state =
      stateMap instanceof Map ? stateMap.get(entry.id) : stateMap?.[entry.id];
    const score = dueScore(entry, state ?? null, now);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore < 0 ? null : best;
}
