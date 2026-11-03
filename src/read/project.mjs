import { codePoints } from '../context/budget.mjs';
import { projectOverview } from '../write/project.mjs';

const DEFAULT_MAX_CHARS = 8000;

function clampChars(value) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(16000, Math.max(1000, Math.round(value)));
}

function decodeCursor(cursor) {
  if (cursor === null) return { index: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.tool !== 'memsys_project_get') return null;
    return { index: Number(parsed.index ?? 0), projectId: parsed.projectId };
  } catch {
    return null;
  }
}

function encodeCursor(state) {
  return Buffer.from(JSON.stringify({ v: 1, tool: 'memsys_project_get', ...state }), 'utf8').toString('base64url');
}

/**
 * memsys_project_get: identity plus the read-only Overview projection and, on
 * request, the full version history. Not a second authority: projects stores
 * identity only; state.project is rebuildable from project-update events.
 */
export function projectGet({ main, clock, projectId, history = false, cursor = null, maxChars = DEFAULT_MAX_CHARS }) {
  const reading = clock.at().at;
  const overview = projectOverview(main, { projectId });
  if (!overview) return { status: 'error', code: 'project_missing', clock: reading };
  const events = main
    .prepare(
      `SELECT * FROM relations WHERE type = 'project-update'
       AND json_extract(payload, '$.projectId') = ? ORDER BY json_extract(payload, '$.revision') ASC`,
    )
    .all(projectId)
    .map((relation) => ({ relation, payload: JSON.parse(relation.payload) }));

  const versions = events.map(({ relation, payload }) => ({
    revision: Number(payload.revision),
    baseRevision: Number(payload.baseRevision),
    snapshot: payload.snapshot,
    evidence_refs: payload.evidence_refs,
    origin: payload.origin,
    semantic_status: payload.semantic_status,
    receiptId: payload.receiptId ?? null,
    changed_fields: payload.changed_fields ?? [],
    inherited_fields: payload.inherited_fields ?? [],
    commit_seq: Number(relation.commit_seq),
  }));

  if (!history) {
    return {
      status: 'ok',
      project: overview,
      versions_count: versions.length,
      headRevision: overview.headRevision,
      effectiveRevision: overview.effectiveRevision,
      clock: reading,
    };
  }

  const decoded = decodeCursor(cursor);
  if (!decoded) return { status: 'error', code: 'invalid_cursor', clock: reading };
  if (cursor !== null && decoded.projectId !== projectId) {
    return { status: 'error', code: 'invalid_cursor', reason: 'cursor_binding_mismatch', clock: reading };
  }
  const ordered = versions.slice().reverse();
  const budget = clampChars(maxChars);
  const page = [];
  let used = 0;
  let index = decoded.index;
  while (index < ordered.length) {
    const entry = ordered[index];
    const size = codePoints(JSON.stringify(entry.snapshot ?? {})) + codePoints(String(entry.revision));
    if (page.length > 0 && used + size > budget) break;
    page.push(entry);
    used += size;
    index += 1;
  }
  const nextCursor = index < ordered.length ? encodeCursor({ projectId, index }) : null;
  return {
    status: 'ok',
    project: overview,
    versions: page,
    next_cursor: nextCursor,
    truncated: nextCursor !== null,
    clock: reading,
  };
}
