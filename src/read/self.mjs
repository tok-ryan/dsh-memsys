import { codePoints } from '../context/budget.mjs';
import { listSelfNotes } from '../storage/repositories.mjs';
import { foldJudgmentVerdicts, foldSelfNoteBranches } from '../storage/replay.mjs';

const DEFAULT_MAX_CHARS = 8000;
const KINDS = new Set(['self_note', 'judgment', 'speculation']);

function clampChars(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(16000, Math.max(1000, Math.round(value)));
}

function decodeCursor(cursor) {
  if (cursor === null) return { index: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.tool !== 'memsys_self_get') return null;
    return { index: Number(parsed.index ?? 0), kind: parsed.kind, view: parsed.view };
  } catch {
    return null;
  }
}

function encodeCursor(state) {
  return Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_self_get', ...state }), 'utf8').toString('base64url');
}

function judgmentStateRow(db, judgmentId) {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(`judgment:${judgmentId}`);
  return row ? JSON.parse(row.value) : null;
}

/**
 * memsys_self_get: original self text / judgments / speculations. These objects
 * never enter automatic injection; this read adds no memory lookup.
 */
export function selfGet({ main, clock, kind = 'self_note', ids = null, view = 'current', cursor = null, maxChars = DEFAULT_MAX_CHARS }) {
  const reading = clock.at().at;
  if (!KINDS.has(kind)) {
    return { status: 'error', code: 'validation_error', message: 'invalid_kind', clock: reading };
  }
  if (ids !== null) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) {
      return { status: 'error', code: 'validation_error', message: 'ids_must_be_1_to_10', clock: reading };
    }
    if (new Set(ids).size !== ids.length) {
      return { status: 'error', code: 'validation_error', message: 'ids_must_be_unique', clock: reading };
    }
  }
  if (view !== 'current' && view !== 'history') {
    return { status: 'error', code: 'validation_error', message: 'invalid_view', clock: reading };
  }
  const decoded = decodeCursor(cursor);
  if (!decoded) return { status: 'error', code: 'invalid_cursor', clock: reading };
  if (cursor !== null && (decoded.kind !== kind || decoded.view !== view)) {
    return { status: 'error', code: 'invalid_cursor', reason: 'cursor_binding_mismatch', clock: reading };
  }
  const relations = main
    .prepare('SELECT * FROM relations ORDER BY commit_seq ASC, ordinal ASC, id ASC')
    .all();

  let entries;
  const missing = [];
  if (kind === 'self_note') {
    const notes = listSelfNotes(main);
    const { edges, supersededBy } = foldSelfNoteBranches(relations);
    const byId = new Map(notes.map((note) => [note.id, note]));
    if (ids !== null) {
      entries = [];
      for (const id of ids) {
        const note = byId.get(id);
        if (!note) {
          missing.push(id);
          continue;
        }
        entries.push(noteItem(note, supersededBy, edges));
      }
    } else {
      const selected =
        view === 'current' ? notes.filter((note) => !supersededBy.has(note.id)) : notes;
      entries = selected.map((note) => noteItem(note, supersededBy, edges));
    }
  } else if (kind === 'judgment') {
    const rows = main.prepare('SELECT * FROM judgments ORDER BY at ASC, id ASC').all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const selected = ids !== null ? [] : rows.slice();
    if (ids !== null) {
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          missing.push(id);
          continue;
        }
        selected.push(row);
      }
    }
    entries = selected.map((row) => {
      const verdict = foldJudgmentVerdicts(relations, row.id);
      const events = relations
        .filter((relation) => {
          if (!['outcome-change', 'verdict', 'needs-review'].includes(relation.type)) return false;
          return JSON.parse(relation.payload).judgmentId === row.id;
        })
        .map((relation) => ({
          type: relation.type,
          payload: JSON.parse(relation.payload),
          commitSeq: Number(relation.commit_seq),
        }));
      const state = judgmentStateRow(main, row.id) ?? {};
      return {
        id: row.id,
        kind: 'judgment',
        verdict_text: row.verdict_text,
        basis: row.basis,
        falsifier: row.falsifier,
        evidence_refs: JSON.parse(row.evidence_refs ?? '[]'),
        evidence_origin: row.evidence_origin,
        origin: row.origin,
        topic_key: row.topic_key,
        key_status: row.key_status,
        binding_status: row.binding_status,
        at: row.at,
        outcome: state.outcome ?? row.outcome,
        outcome_revision: Number(state.outcomeRevision ?? 0),
        verdict,
        needs_review: state.needsReview === true,
        unreviewed: state.unreviewed === true,
        history: events,
      };
    });
  } else {
    const rows = main.prepare('SELECT * FROM speculations ORDER BY at ASC, id ASC').all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const selected = ids !== null ? [] : rows.slice();
    if (ids !== null) {
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          missing.push(id);
          continue;
        }
        selected.push(row);
      }
    }
    entries = selected.map((row) => ({
      id: row.id,
      kind: 'speculation',
      text: row.text,
      basis: row.basis,
      falsifier: row.falsifier,
      basis_refs: JSON.parse(row.basis_refs ?? '[]'),
      linked_judgment_ids: JSON.parse(row.linked_judgment_ids ?? '[]'),
      origin: row.origin,
      at: row.at,
    }));
  }

  const budget = clampChars(maxChars);
  const items = [];
  let used = 0;
  let index = decoded.index;
  while (index < entries.length) {
    const entry = entries[index];
    const size = codePoints(entry.text ?? entry.verdict_text ?? '') + codePoints(entry.id);
    if (items.length > 0 && used + size > budget) break;
    items.push(entry);
    used += size;
    index += 1;
  }
  const nextCursor = index < entries.length ? encodeCursor({ kind, view, index }) : null;
  return {
    status: 'ok',
    items,
    missing_ids: missing,
    total_count: entries.length,
    next_cursor: nextCursor,
    truncated: nextCursor !== null,
    clock: reading,
  };
}

function noteItem(note, supersededBy, edges) {
  const superseded = supersededBy.get(note.id) ?? null;
  return {
    id: note.id,
    kind: 'self_note',
    text: note.text,
    reason: note.reason,
    basis_refs: JSON.parse(note.basis_refs ?? '[]'),
    reflection_judgment_ids: JSON.parse(note.reflection_judgment_ids ?? '[]'),
    author_runtime: JSON.parse(note.author_runtime),
    origin: note.origin,
    at: note.at,
    state_snapshot: JSON.parse(note.state_snapshot ?? '{}'),
    initial_strength: Number(note.initial_strength),
    status: superseded ? 'superseded' : 'current',
    superseded_by: superseded ? superseded : [],
    history: edges
      .filter((edge) => edge.oldId === note.id || edge.newId === note.id)
      .map((edge) => ({
        type: 'supersede',
        oldId: edge.oldId,
        newId: edge.newId,
        reason: edge.reason,
        commitSeq: edge.commitSeq,
        ordinal: edge.ordinal,
      })),
  };
}
