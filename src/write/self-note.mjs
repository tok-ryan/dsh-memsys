import {
  canonicalJson,
  kindBusinessKey,
  keys,
  objectId,
  payloadHash,
} from '../identity.mjs';
import {
  buildStateSnapshot,
  initialStrength,
  SELF_AUTHOR_ROLES,
  SELF_NOTE_FORBIDDEN_FIELDS,
} from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactObservation } from '../control/readback.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getMemory,
  getObservation,
  getSelfNote,
  getSelfNoteByKey,
  insertObservation,
  insertSelfNote,
  listRelationsByType,
} from '../storage/repositories.mjs';
import {
  WriteError,
  assertNoForbiddenFields,
  modelOrigin,
  stripAuditTimes,
} from './authority.mjs';
import { foldOrigin, parseOriginTokens } from './origin.mjs';
import { createNeedsReview } from './judgment-review.mjs';

const REF_TABLES = Object.freeze({
  obs_: 'observations',
  cand_: 'candidates',
  mem_: 'memories',
  sn_: 'self_notes',
});

function refTable(id) {
  for (const [prefix, table] of Object.entries(REF_TABLES)) {
    if (id.startsWith(prefix)) return table;
  }
  return null;
}

function verifyRefs(db, refs) {
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new WriteError('validation_error', { field: 'basis_refs' });
    }
    const table = refTable(ref);
    if (!table) throw new WriteError('validation_error', { field: 'basis_refs', ref });
    const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).get(ref);
    if (!row) throw new WriteError('validation_error', { field: 'basis_refs', ref });
  }
}

function originForBasis(db, refs, runtime) {
  const tokens = [];
  for (const ref of refs) {
    const table = refTable(ref);
    if (!table) continue;
    const row = db.prepare(`SELECT origin FROM ${table} WHERE id = ?`).get(ref);
    if (row) tokens.push(...parseOriginTokens(row.origin));
  }
  tokens.push(modelOrigin(runtime));
  return canonicalJson([...new Set(tokens)].sort());
}

/** Author must be the trusted daily or dream model; owner cannot ghost-write. */
export function assertSelfAuthor(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new WriteError('invalid_runtime');
  if (!SELF_AUTHOR_ROLES.includes(runtime.role)) {
    throw new WriteError('invalid_role', { role: runtime.role ?? null });
  }
  if (!runtime.sessionId || !runtime.callId) {
    throw new WriteError('runtime_identity_unavailable');
  }
  if (!runtime.identity) throw new WriteError('runtime_identity_unavailable');
  return runtime;
}

function modelObservation(runtime, clock, { text, callId, slot }, deps) {
  const businessKey = keys.observationModel(runtime.sessionId, callId, slot);
  const observationId = objectId('obs', businessKey);
  const existing = getObservation(deps.main, observationId);
  if (existing) return { observation: existing, replayed: true };

  const origin = modelOrigin(runtime);
  const row = {
    id: observationId,
    idempotency_key: businessKey,
    at: clock.at().at,
    payload_hash: payloadHash({ text, source: 'model', authorKind: 'model', origin }),
    text,
    source: 'model',
    author_kind: 'model',
    runtime_refs: JSON.stringify({ sessionId: runtime.sessionId, callId }),
    origin,
    lossy: 0,
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
    initial_strength: initialStrength(),
    recorded_at: clock.at().at,
  };
  const receipt = commitControlled({
    control: deps.control,
    clock,
    spec: {
      objectKey: `main:${observationId}`,
      targetDb: 'main',
      requestKey: `observe-model:${businessKey}`,
      payloadHash: row.payload_hash,
      immutablePayload: canonicalJson({ text, source: 'model', authorKind: 'model', origin }),
      targetIds: [observationId],
      hooks: deps.commitHooks ?? {},
    },
    writeTxn: () => {
      if (!getObservation(deps.main, observationId)) insertObservation(deps.main, row);
    },
    readExact: () => readExactObservation(deps.main, row),
  });
  const stored = getObservation(deps.main, observationId);
  return { observation: stored, replayed: receipt.replayed === true, receipt };
}

function assertSelfNoteItem(runtime, item) {
  const forbidden = SELF_NOTE_FORBIDDEN_FIELDS.filter((field) => item[field] !== undefined);
  if (forbidden.length > 0) {
    throw new WriteError('validation_error', { forbidden_fields: forbidden });
  }
  assertNoForbiddenFields(item);
  if (typeof item.text !== 'string' || item.text.length === 0) {
    throw new WriteError('validation_error', { field: 'text' });
  }
  if (typeof item.reason !== 'string' || item.reason.length === 0) {
    throw new WriteError('validation_error', { field: 'reason' });
  }
  const basisRefs = item.basis_refs ?? item.basisRefs ?? [];
  if (!Array.isArray(basisRefs)) throw new WriteError('validation_error', { field: 'basis_refs' });
  const reflection = item.reflection_judgment_ids ?? item.reflectionJudgmentIds ?? [];
  if (!Array.isArray(reflection)) {
    throw new WriteError('validation_error', { field: 'reflection_judgment_ids' });
  }
  const supersedesId = item.supersedesId ?? item.supersedes_id ?? null;
  if (supersedesId !== null && typeof supersedesId !== 'string') {
    throw new WriteError('validation_error', { field: 'supersedesId' });
  }
  void runtime;
  return { basisRefs, reflection, supersedesId };
}

/** Detect a cycle in the existing self-note supersede graph (defensive). */
function graphHasCycle(db) {
  const edges = listRelationsByType(db, 'supersede')
    .map((relation) => JSON.parse(relation.payload))
    .filter((payload) => payload.targetType === 'self_note');
  const adjacency = new Map();
  for (const edge of edges) {
    adjacency.set(edge.oldId, [...(adjacency.get(edge.oldId) ?? []), edge.newId]);
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (walk(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of adjacency.keys()) if (walk(id)) return true;
  return false;
}

function existingResult(db, businessKey, itemPayload) {
  const existing = getSelfNoteByKey(db, businessKey);
  if (!existing) return null;
  const same = existing.payload_hash === payloadHash(itemPayload);
  if (!same) {
    const err = new WriteError('idempotency_conflict', { businessKey });
    throw err;
  }
  return existing;
}

/**
 * B1 self note. Original model output is committed first, then the note itself;
 * revisions are supersede relations, never an UPDATE on the note row.
 */
export function recordSelfNotes(runtime, request, deps) {
  assertSelfAuthor(runtime);
  const { main, clock } = deps;
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  return {
    items: items.map((item, slot) => recordOne(runtime, item, slot, request, deps, main, clock)),
  };
}

function recordOne(runtime, item, slot, request, deps, main, clock) {
  const { main: db, control, commitHooks = {} } = deps;
  try {
    const { item: clean, violations } = stripAuditTimes(item ?? {});
    const { basisRefs, reflection, supersedesId } = assertSelfNoteItem(runtime, clean);
    for (const judgmentId of reflection) {
      if (typeof judgmentId !== 'string' || !judgmentId.startsWith('jdg_')) {
        return { slot, error: 'validation_error', field: 'reflection_judgment_ids' };
      }
      const judgment = db.prepare('SELECT 1 AS ok FROM judgments WHERE id = ?').get(judgmentId);
      if (!judgment) return { slot, error: 'validation_error', field: 'reflection_judgment_ids' };
    }
    if (supersedesId !== null && supersedesId.startsWith('sn_') === false) {
      return { slot, error: 'validation_error', field: 'supersedesId', message: 'cross_type_edge' };
    }
    const callId = runtime.callId;
    const businessKey = kindBusinessKey('self_note', callId, slot);
    const noteId = objectId('sn', businessKey);
    if (supersedesId === noteId) {
      return { slot, error: 'validation_error', field: 'supersedesId', message: 'self_loop' };
    }
    verifyRefs(db, basisRefs);

    const payload = {
      text: clean.text,
      reason: clean.reason,
      basis_refs: basisRefs,
      reflection_judgment_ids: reflection,
      supersedesId,
    };
    const replayed = existingResult(db, businessKey, payload);
    if (replayed) {
      return { slot, id: replayed.id, status: 'found', replayed: true };
    }
    if (supersedesId !== null) {
      const target = getSelfNote(db, supersedesId);
      if (!target) return { slot, error: 'validation_error', field: 'supersedesId', message: 'target_missing' };
      if (graphHasCycle(db)) {
        withImmediate(db, () => {
          appendRelation(db, {
            type: 'conflict',
            payload: { refs: [supersedesId, noteId], reason: 'self_note_supersede_cycle', requestId: businessKey },
            businessKey: `self-note-cycle:${businessKey}`,
            at: clock.at().at,
            strict: false,
          });
        });
        return { slot, error: 'conflict', message: 'self_note_supersede_cycle' };
      }
    }

    const observation = modelObservation(runtime, clock, { text: clean.text, callId, slot }, deps);
    if (!observation.observation) {
      return { slot, error: 'observation_write_failed' };
    }
    const inputSeqRow = db.prepare('SELECT value FROM state WHERE key = ?').get(`input-seq:${runtime.identity}`);
    const inputSeq = inputSeqRow ? Number(JSON.parse(inputSeqRow.value).value ?? 0) : 0;
    const at = clock.at().at;
    const authorRuntime = {
      role: runtime.role,
      identity: runtime.identity,
      sessionId: runtime.sessionId,
      callId,
    };
    const row = {
      id: noteId,
      idempotency_key: businessKey,
      at,
      payload_hash: payloadHash(payload),
      observation_id: observation.observation.id,
      text: clean.text,
      reason: clean.reason,
      basis_refs: canonicalJson(basisRefs),
      reflection_judgment_ids: canonicalJson(reflection),
      author_runtime: canonicalJson(authorRuntime),
      origin: originForBasis(db, basisRefs, runtime),
      state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
      initial_strength: initialStrength(),
    };

    const writeTxn = () =>
      withImmediate(db, () => {
        if (getSelfNote(db, noteId)) return;
        insertSelfNote(db, row);
        for (const judgmentId of reflection) {
          createNeedsReview(db, {
            judgmentId,
            trigger: 'reflection',
            sourceVersion: `${noteId}:${row.payload_hash}`,
            why: 'self note explicitly reflects on this judgment',
            at,
            inputSeq,
          });
        }
        if (violations.length > 0) {
          appendRelation(db, {
            type: 'violation',
            payload: { kind: 'audit_time_rejected', fields: violations, sessionId: runtime.sessionId },
            businessKey: `${noteId}:${violations.join(',')}`,
            at,
          });
        }
        if (supersedesId !== null) {
          const target = getSelfNote(db, supersedesId);
          appendRelation(db, {
            type: 'supersede',
            payload: {
              targetType: 'self_note',
              oldId: supersedesId,
              newId: noteId,
              reason: 'self_revision',
              authority: { role: runtime.role, authorRuntime },
              oldRevision: target.payload_hash,
            },
            businessKey: `${supersedesId}:${noteId}`,
            at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          });
        }
      });

    const readExact = () => {
      const stored = getSelfNote(db, noteId);
      if (!stored) return { status: 'missing', reason: 'self_note_absent' };
      const expectedFields = ['id', 'idempotency_key', 'payload_hash', 'observation_id', 'text', 'reason', 'basis_refs', 'reflection_judgment_ids', 'author_runtime', 'origin'];
      for (const field of expectedFields) {
        if (stored[field] !== row[field]) {
          return { status: 'unknown', reason: 'field_mismatch', field };
        }
      }
      if (supersedesId !== null) {
        const edge = db
          .prepare('SELECT 1 AS ok FROM relations WHERE type = ? AND dedupe_key = ?')
          .get('supersede', canonicalJson(['supersede', `${supersedesId}:${noteId}`]));
        if (!edge) return { status: 'unknown', reason: 'supersede_event_missing' };
      }
      return { status: 'found', row: stored };
    };

    const receipt = commitControlled({
      control,
      clock,
      spec: {
        objectKey: `main:${noteId}`,
        targetDb: 'main',
        requestKey: `self-note:${businessKey}`,
        payloadHash: row.payload_hash,
        immutablePayload: canonicalJson(payload),
        targetIds: [noteId, observation.observation.id],
        hooks: commitHooks,
      },
      writeTxn,
      readExact,
    });
    if (receipt.status !== 'found') {
      return {
        slot,
        id: noteId,
        status: receipt.status,
        error: receipt.readback?.reason ?? 'readback_not_found',
        failures: receipt.consecutiveFailures,
        frozen: receipt.frozen,
      };
    }
    const stored = getSelfNote(db, noteId);
    return {
      slot,
      id: noteId,
      status: 'found',
      replayed: false,
      revision: stored.payload_hash,
      supersedesId,
    };
  } catch (err) {
    if (err instanceof WriteError) {
      return { slot, error: err.code, detail: err.detail ?? null, message: err.message };
    }
    return { slot, error: err.code ?? 'write_failed', message: err.message };
  }
}

/** Fold a note's origin credibility (read-time, never cached as verified). */
export function selfNoteCredibility(db, note) {
  return foldOrigin(note.origin, { db }).credibility;
}

export { getMemory as _getMemory };
