import { currentRevision } from '../storage/open.mjs';
import { codePoints } from '../context/budget.mjs';
import { pageText } from './pager.mjs';

const MAX_IDS = 10;
const DEFAULT_MAX_CHARS = 8000;
const MIN_MAX_CHARS = 1000;
const MAX_MAX_CHARS = 16000;

function clampChars(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.round(value)));
}

function formatMemory(main, row, { includeEvidence = false, history = false } = {}) {
  const timeline = main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(row.id);
  const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(row.id);
  const relationRows = history
    ? main
        .prepare(
          `SELECT type, payload, commit_seq FROM relations
           WHERE json_extract(payload, '$.oldId') = ?
              OR json_extract(payload, '$.targetId') = ?
              OR json_extract(payload, '$.memoryId') = ?
           ORDER BY commit_seq ASC`,
        )
        .all(row.id, row.id, row.id)
    : [];
  const evidence = includeEvidence
    ? main.prepare('SELECT * FROM evidence WHERE memory_id = ? ORDER BY id').all(row.id)
    : [];
  return {
    id: row.id,
    text: row.text,
    detail: row.detail,
    why: row.why,
    type: row.type,
    scene: row.scene,
    scope: row.scope,
    semantic_status: row.semantic_status,
    record_kind: row.record_kind,
    credibility: row.credibility,
    origin: row.origin,
    weight: Number(row.weight),
    tags: JSON.parse(row.tags ?? '[]'),
    group: {
      topic_key: row.topic_key,
      key_status: row.key_status ?? 'legacy_binding_unknown',
      binding_status: row.binding_status ?? 'legacy_binding_unknown',
      conflict_marker: Boolean(
        main
          .prepare("SELECT payload FROM relations WHERE type = 'conflict'")
          .all()
          .some((relation) => {
            try {
              const payload = JSON.parse(relation.payload);
              return payload.memoryId === row.id || (Array.isArray(payload.refs) && payload.refs.includes(row.id));
            } catch {
              return false;
            }
          }),
      ),
      legacy: row.key_status === null || row.binding_status === null,
    },
    due: { state: row.due_state, done_at: row.due_done_at },
    timeline: timeline
      ? {
          start: timeline.start_at,
          end: timeline.end_at,
          prec_start: timeline.prec_start,
          prec_end: timeline.prec_end,
          time_state: timeline.time_state,
          revision: Number(timeline.revision),
        }
      : null,
    pointer: pointer
      ? {
          status: pointer.status,
          location: pointer.location,
          search_hint: pointer.search_hint,
          lossy: Number(pointer.lossy),
          revision: Number(pointer.revision),
        }
      : null,
    evidence: evidence.map((entry) => {
      const observation = entry.observation_id
        ? main.prepare('SELECT text FROM observations WHERE id = ?').get(entry.observation_id)
        : null;
      return {
        id: entry.id,
        observation_id: entry.observation_id,
        source_memory_id: entry.source_memory_id,
        role: entry.role,
        source_span: entry.source_span,
        observation_text: observation?.text ?? null,
      };
    }),
    recorded_at: row.recorded_at,
    last_touched_at: row.last_touched_at,
    history: relationRows.map((entry) => ({
      type: entry.type,
      payload: JSON.parse(entry.payload),
      commit_seq: Number(entry.commit_seq),
    })),
  };
}

function versionMapOf(main, ids) {
  const versions = {};
  for (const id of ids) {
    const row = main.prepare('SELECT payload_hash FROM memories WHERE id = ?').get(id);
    const timeline = main.prepare('SELECT revision FROM timeline WHERE memory_id = ?').get(id);
    const pointer = main.prepare('SELECT revision FROM pointers WHERE memory_id = ?').get(id);
    versions[id] = [row?.payload_hash ?? null, Number(timeline?.revision ?? 0), Number(pointer?.revision ?? 0)];
  }
  return versions;
}

function encodeGetCursor(state) {
  return Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_get', ...state }), 'utf8').toString(
    'base64url',
  );
}

function decodeGetCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.tool !== 'memsys_get' || !Array.isArray(parsed.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * memsys_get: read stored text by id. Any state can be fetched by id; missing
 * and unreadable are separated, and pagination continues oversized text.
 */
export function getMemories({
  main,
  clock,
  ids,
  view = 'current',
  includeEvidence = false,
  cursor = null,
  maxChars = DEFAULT_MAX_CHARS,
}) {
  const reading = clock.at().at;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS) {
    return { status: 'error', code: 'validation_error', message: 'ids_must_be_1_to_10', clock: reading };
  }
  if (new Set(ids).size !== ids.length) {
    return { status: 'error', code: 'validation_error', message: 'ids_must_be_unique', clock: reading };
  }
  if (view !== 'current' && view !== 'history') {
    return { status: 'error', code: 'validation_error', message: 'invalid_view', clock: reading };
  }

  let state = { ids, index: 0, offset: 0, versions: null };
  if (cursor !== null) {
    const decoded = decodeGetCursor(cursor);
    if (!decoded || decoded.ids.join(',') !== ids.join(',')) {
      return { status: 'error', code: 'invalid_cursor', clock: reading };
    }
    const currentVersions = versionMapOf(main, decoded.ids);
    if (JSON.stringify(decoded.versions ?? {}) !== JSON.stringify(currentVersions)) {
      return { status: 'error', code: 'stale_cursor', clock: reading };
    }
    state = { ids: decoded.ids, index: decoded.index, offset: decoded.offset, versions: decoded.versions };
  }

  const budget = clampChars(maxChars);
  const items = [];
  const missing = [];
  let used = 0;
  let index = state.index;
  let offset = state.offset;

  while (index < ids.length) {
    const id = ids[index];
    if (String(id).startsWith('obs_')) {
      const observation = main.prepare('SELECT * FROM observations WHERE id = ?').get(id);
      if (!observation) {
        missing.push(id);
        index += 1;
        offset = 0;
        continue;
      }
      const observationText = observation.text ?? '';
      const remaining = Math.max(1, budget - used);
      if (offset === 0 && codePoints(observationText) <= remaining) {
        items.push({
          id: observation.id,
          kind: 'observation',
          text: observationText,
          source: observation.source,
          author_kind: observation.author_kind,
          origin: observation.origin,
          lossy: Number(observation.lossy),
          recorded_at: observation.recorded_at,
        });
        index += 1;
        offset = 0;
        continue;
      }
      const fragment = pageText(observationText, { path: 'text', offset, maxChars: remaining });
      items.push({
        id: observation.id,
        kind: 'observation',
        text: fragment.text,
        source: observation.source,
        author_kind: observation.author_kind,
        origin: observation.origin,
        lossy: Number(observation.lossy),
        recorded_at: observation.recorded_at,
        text_fragment: {
          path: fragment.path,
          offset: fragment.offset,
          total_chars: fragment.total_chars,
          fragment_complete: fragment.fragment_complete,
        },
      });
      const nextOffset = fragment.fragment_complete ? 0 : fragment.offset + codePoints(fragment.text);
      const nextCursor = fragment.fragment_complete
        ? index + 1 < ids.length
          ? encodeGetCursor({ ids, index: index + 1, offset: 0, versions: versionMapOf(main, ids) })
          : null
        : encodeGetCursor({ ids, index, offset: nextOffset, versions: versionMapOf(main, ids) });
      return {
        status: 'ok',
        items,
        missing_ids: missing,
        snapshot_revision: currentRevision(main),
        next_cursor: nextCursor,
        truncated: nextCursor !== null,
      };
    }
    let row;
    try {
      row = main.prepare('SELECT * FROM memories WHERE id = ?').get(id) ?? null;
    } catch (err) {
      return { status: 'error', code: 'read_error', message: err.message, clock: reading };
    }
    if (!row) {
      missing.push(id);
      index += 1;
      offset = 0;
      continue;
    }
    const formatted = formatMemory(main, row, {
      includeEvidence,
      history: view === 'history',
    });
    const text = formatted.text ?? '';
    if (offset === 0 && used + codePoints(text) <= budget) {
      if (includeEvidence && Array.isArray(formatted.evidence)) {
        let left = budget - used - codePoints(text);
        for (const entry of formatted.evidence) {
          if (typeof entry.observation_text !== 'string' || entry.observation_text.length === 0) continue;
          const chars = Array.from(entry.observation_text);
          if (chars.length <= left) {
            left -= chars.length;
            continue;
          }
          entry.observation_text = chars.slice(0, Math.max(0, left)).join('');
          entry.observation_text_truncated = true;
          left = 0;
        }
      }
      items.push(formatted);
      used += codePoints(text);
      index += 1;
      offset = 0;
      continue;
    }
    const fragment = pageText(text, { path: 'text', offset, maxChars: Math.max(1, budget - used) });
    items.push({
      ...formatted,
      text: fragment.text,
      text_fragment: {
        path: fragment.path,
        offset: fragment.offset,
        total_chars: fragment.total_chars,
        fragment_complete: fragment.fragment_complete,
      },
    });
    used = budget;
    const nextOffset = fragment.fragment_complete
      ? 0
      : fragment.offset + codePoints(fragment.text);
    const nextIndex = fragment.fragment_complete ? index + 1 : index;
    const nextCursor =
      nextIndex < ids.length
        ? encodeGetCursor({
            ids,
            index: nextIndex,
            offset: nextOffset,
            versions: state.versions ?? versionMapOf(main, ids),
          })
        : null;
    return {
      status: 'ok',
      items,
      missing_ids: missing,
      snapshot_revision: currentRevision(main),
      next_cursor: nextCursor,
      truncated: nextCursor !== null,
      clock: reading,
    };
  }

  return {
    status: 'ok',
    items,
    missing_ids: missing,
    snapshot_revision: currentRevision(main),
    next_cursor: null,
    truncated: false,
    clock: reading,
  };
}
