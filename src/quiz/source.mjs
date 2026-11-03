import { replayMain } from '../storage/replay.mjs';

/**
 * Quiz source adapter: a read-only projection of `memories` into the entry shape
 * the quiz scheduler and prompt builder understand.
 *
 * Hard boundary (echo's old rule, kept): this module never writes `memories`,
 * never touches `uses`, never changes a verdict or credibility field.
 *
 * Mapping decisions (memsys has no gist / confidence / pinned / status column):
 * - raw    = memories.text
 * - gist   = memories.why. `detail` is NOT usable as a gist: it was measured
 *            byte-identical to `text` in 25/25 rows. `why` is the "why this was
 *            kept" distillation and is what the pick prompt shows as
 *            "我的理解" (D3).
 * - title  = first 16 code points of text, DISPLAY ONLY. It must never enter the
 *            pick prompt: it is a prefix of raw and would hand out cover for free.
 * - weight = initial_strength * 100, i.e. 0..100. schedule.mjs divides by 100
 *            again so the scale matches echo's emotional_weight/100.
 * - confidence = candidates.confidence reached through promoted_from (0.5 when
 *            absent). Display only; it never enters dueScore.
 * - pinned = false, always. There is no pinned column in memsys and inventing
 *            one would be a lie; the 1.6 boost stays dormant until an owner mark
 *            exists.
 * - status = folded memory state from the append-only relation ledger
 *            (active / superseded / corrected / retired).
 *
 * Filter policy:
 * - `retired` is ALWAYS excluded (hard requirement).
 * - `corrected` / `superseded` are excluded by default: stale wording must not be
 *   quizzed as if it were the current answer. `opts.includeStale` re-enables them.
 * - `credibility = 'from-dream'` is excluded by default (D4): quizzing a dream
 *   guess would launder speculation into "learned". `opts.includeDream` re-enables.
 * - Rows with empty text are skipped.
 */

const TITLE_CODE_POINTS = 16;
const DEFAULT_LIMIT = 1000;

export function toEntry(row, extra = {}) {
  const text = typeof row.text === 'string' ? row.text : '';
  const why = typeof row.why === 'string' ? row.why : '';
  const strength = Number(row.initial_strength);
  const confidence = Number(extra.confidence);
  return {
    id: row.id,
    title: Array.from(text).slice(0, TITLE_CODE_POINTS).join(''),
    gist: why,
    raw: text,
    weight: Number.isFinite(strength) ? Math.round(strength * 100) : 0,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    pinned: false,
    status: extra.status ?? 'active',
  };
}

export function listCandidates(db, opts = {}) {
  const { includeDream = false, includeStale = false, limit = DEFAULT_LIMIT } = opts;
  const rows = db
    .prepare(
      `SELECT m.*, c.confidence AS candidate_confidence
         FROM memories m
         LEFT JOIN candidates c ON c.id = m.promoted_from
        ORDER BY m.recorded_at ASC, m.id ASC`,
    )
    .all();
  const folded = replayMain(db).memories;
  const entries = [];
  for (const row of rows) {
    if (entries.length >= limit) break;
    if (!includeDream && row.credibility === 'from-dream') continue;
    const status = folded.get(row.id) ?? 'active';
    if (status === 'retired') continue;
    if (!includeStale && status !== 'active') continue;
    if (typeof row.text !== 'string' || row.text.length === 0) continue;
    entries.push(toEntry(row, { confidence: row.candidate_confidence, status }));
  }
  return entries;
}
