import { appendRelation, getMemory } from '../storage/repositories.mjs';
import { withImmediate } from '../storage/open.mjs';

const KINDS = new Set(['lookup', 'used', 'owner_mention']);

/**
 * Activity bookkeeping (§9.0b). Only a real lookup adds uses; `used` and
 * `owner_mention` may refresh last_touched_at but never the uses counter.
 * Same round + memory is idempotent; later corrections need new evidence.
 */
export function recordLookup({ main, clock, roundId, memoryId, kind = 'lookup', evidenceRefs = [] }) {
  if (!KINDS.has(kind)) {
    return { status: 'error', code: 'validation_error', message: 'invalid_kind' };
  }
  return withImmediate(main, () => {
    const memory = getMemory(main, memoryId);
    if (!memory) return { status: 'missing', memoryId };
    const at = clock.at().at;
    const businessKey = `${roundId}:${memoryId}:${kind}`;
    const existingRelation = main
      .prepare('SELECT id FROM relations WHERE dedupe_key = ?')
      .get(`memory-touch:${businessKey}`);
    if (existingRelation) {
      const uses = main.prepare('SELECT count FROM uses WHERE memory_id = ?').get(memoryId);
      return { status: 'duplicate', memoryId, uses: Number(uses?.count ?? 0) };
    }
    appendRelation(main, {
      type: 'memory-touch',
      payload: { memoryId, roundId, kind, evidenceRefs },
      businessKey,
      at,
    });
    let uses = Number(
      main.prepare('SELECT count FROM uses WHERE memory_id = ?').get(memoryId)?.count ?? 0,
    );
    if (kind === 'lookup') {
      uses += 1;
      main
        .prepare(
          `INSERT INTO uses (memory_id, count, last_used_at) VALUES (?, ?, ?)
           ON CONFLICT(memory_id) DO UPDATE SET count = excluded.count, last_used_at = excluded.last_used_at`,
        )
        .run(memoryId, uses, at);
    }
    const lastTouched = memory.last_touched_at ?? memory.recorded_at;
    const nextTouched = Date.parse(at) > Date.parse(lastTouched) ? at : lastTouched;
    main.prepare('UPDATE memories SET last_touched_at = ? WHERE id = ?').run(nextTouched, memoryId);
    return { status: 'ok', memoryId, kind, uses, last_touched_at: nextTouched };
  });
}

export function listUses(main) {
  return main
    .prepare('SELECT memory_id, count, last_used_at FROM uses ORDER BY count DESC, memory_id')
    .all()
    .map((row) => ({ memoryId: row.memory_id, count: Number(row.count), lastUsedAt: row.last_used_at }));
}
