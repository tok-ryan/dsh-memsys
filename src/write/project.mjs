import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getRelationByDedupe,
  getState,
  putState,
} from '../storage/repositories.mjs';
import { consumeReceipt, revalidateReceipt, verifyReceipt, verifyReceiptBound } from './owner-actions.mjs';
import { parseOriginTokens } from './origin.mjs';
import { modelOrigin } from './authority.mjs';
import { codePoints } from '../context/budget.mjs';

export const SNAPSHOT_FIELDS = Object.freeze(['current_task', 'progress', 'next_action', 'blockers']);
const MAX_FIELD_CODE_POINTS = 80;
const PROJECT_BYTES_LIMIT = 12288;

function projectTooLarge(name, snapshot) {
  const bytes = Buffer.byteLength(JSON.stringify({ name, snapshot }), 'utf8');
  return bytes > PROJECT_BYTES_LIMIT;
}
const REF_TABLES = Object.freeze({
  obs_: 'observations',
  cand_: 'candidates',
  mem_: 'memories',
  sn_: 'self_notes',
  jdg_: 'judgments',
  spec_: 'speculations',
});

function projectStateKey(projectId) {
  return `project:${projectId}`;
}

function activeKey(sessionId) {
  return `active_project:${sessionId}`;
}

function validateSnapshotInput(snapshot) {
  if (snapshot === undefined || snapshot === null) return {};
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    const err = new Error('validation_error');
    err.code = 'validation_error';
    err.detail = { field: 'snapshot' };
    throw err;
  }
  const out = {};
  for (const key of Object.keys(snapshot)) {
    if (!SNAPSHOT_FIELDS.includes(key)) {
      const err = new Error('validation_error');
      err.code = 'validation_error';
      err.detail = { field: key };
      throw err;
    }
    const value = snapshot[key];
    if (value !== null && typeof value !== 'string') {
      const err = new Error('validation_error');
      err.code = 'validation_error';
      err.detail = { field: key, rule: 'string_or_null' };
      throw err;
    }
    if (typeof value === 'string' && codePoints(value) > MAX_FIELD_CODE_POINTS) {
      const err = new Error('validation_error');
      err.code = 'validation_error';
      err.detail = { field: key, rule: `max_${MAX_FIELD_CODE_POINTS}_code_points` };
      throw err;
    }
    out[key] = value;
  }
  return out;
}

function describeEvidence(db, ref) {
  if (typeof ref !== 'string' || ref.length === 0) {
    return { ref, kind: 'invalid', hash: null, valid: false };
  }
  if (ref.startsWith('verdict:')) {
    const verdictId = ref.slice('verdict:'.length);
    const relation = db.prepare('SELECT * FROM relations WHERE id = ?').get(verdictId);
    if (!relation || relation.type !== 'verdict') {
      return { ref, kind: 'verdict', hash: null, valid: false };
    }
    const voided = db
      .prepare(
        `SELECT 1 AS ok FROM relations
         WHERE type = 'verdict-void' AND json_extract(payload, '$.verdictId') = ?`,
      )
      .get(verdictId);
    const hash = payloadHash(JSON.parse(relation.payload));
    return { ref, kind: 'verdict', hash, valid: !voided };
  }
  for (const [prefix, table] of Object.entries(REF_TABLES)) {
    if (!ref.startsWith(prefix)) continue;
    const row = db.prepare(`SELECT payload_hash, origin FROM ${table} WHERE id = ?`).get(ref);
    if (!row) return { ref, kind: table, hash: null, valid: false };
    return { ref, kind: table, hash: row.payload_hash, valid: true, origin: row.origin };
  }
  return { ref, kind: 'unknown', hash: null, valid: false };
}

function originTokensOf(db, refs) {
  const tokens = [];
  for (const ref of refs) {
    const described = describeEvidence(db, ref);
    if (described.origin) tokens.push(...parseOriginTokens(described.origin));
    if (described.kind === 'verdict' && described.valid) {
      const relation = db.prepare('SELECT payload FROM relations WHERE id = ?').get(ref.slice('verdict:'.length));
      if (relation) {
        const payload = JSON.parse(relation.payload);
        if (payload.evidenceOrigin) tokens.push(...parseOriginTokens(payload.evidenceOrigin));
      }
    }
  }
  return [...new Set(tokens)].sort();
}

function isValid(db, descriptors = []) {
  for (const descriptor of descriptors) {
    const current = describeEvidence(db, descriptor.ref);
    if (!current.valid) return false;
    if (descriptor.hash !== null && current.hash !== descriptor.hash) return false;
  }
  return true;
}

function readProjectState(db, projectId) {
  return getState(db, projectStateKey(projectId))?.value ?? null;
}

function writeProjectState(db, projectId, value, revision) {
  putState(db, projectStateKey(projectId), value, revision);
}

function commit(deps, { objectKey, requestKey, payload, targetIds, writeTxn, readExact }) {
  return commitControlled({
    control: deps.control,
    clock: deps.clock,
    spec: {
      objectKey,
      targetDb: 'main',
      requestKey,
      payloadHash: payloadHash(payload),
      immutablePayload: canonicalJson(payload),
      targetIds,
      hooks: deps.commitHooks ?? {},
    },
    writeTxn,
    readExact,
  });
}

/** Owner-bound project creation: identity + first snapshot (revision 1). */
export function projectCreatePayload({ name, snapshot }) {
  return { action: 'project-create', name, snapshot };
}
export function projectSelectPayload({ projectId, revision, sessionId }) {
  return { action: 'project-select', projectId, revision, sessionId };
}
export function projectCompletePayload({ projectId, revision, snapshotHash }) {
  return { action: 'project-complete', projectId, revision, snapshotHash };
}

export function projectCreatePayloadHash({ name, snapshot }) {
  return payloadHash(projectCreatePayload({ name, snapshot }));
}

export function projectSelectPayloadHash({ projectId, revision, sessionId }) {
  return payloadHash(projectSelectPayload({ projectId, revision, sessionId }));
}

export function projectCompletePayloadHash({ projectId, revision, snapshotHash }) {
  return payloadHash(projectCompletePayload({ projectId, revision, snapshotHash }));
}

export function createProject(deps, { name, receiptId, snapshot = {} }) {
  const { main: db, clock } = deps;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw Object.assign(new Error('validation_error'), { code: 'validation_error', detail: { field: 'name' } });
  }
  const projectId = objectId('proj', canonicalJson([receiptId, name]));
  const businessKey = `project:${receiptId}`;
  const existing = db.prepare('SELECT * FROM projects WHERE idempotency_key = ?').get(businessKey);
  if (existing) {
    if (existing.id !== projectId) {
      return { ok: false, code: 'stale_proposal', reason: 'receipt_bound_to_other_project' };
    }
    return { ok: true, replayed: true, projectId: existing.id, revision: 1 };
  }
  if (projectTooLarge(name, snapshot)) {
    return { ok: false, code: 'project_capacity_blocked', reason: 'bytes_limit' };
  }
  const first = { current_task: null, progress: null, next_action: null, blockers: null };
  Object.assign(first, validateSnapshotInput(snapshot));
  const verified = verifyReceiptBound(db, {
    receiptId,
    action: 'project-create',
    payload: projectCreatePayload({ name, snapshot: first }),
    baseVersions: [],
  });
  if (!verified.ok) return verified;
  const ownerOrigin = `master@${clock.localDate()}`;
  const at = clock.at().at;
  let revision = 1;
  const receipt = commit(deps, {
    objectKey: `main:${projectId}`,
    requestKey: `project-create:${businessKey}`,
    payload: { name, snapshot: first, receiptId },
    targetIds: [projectId],
    writeTxn: () =>
      withImmediate(db, () => {
        const gate = revalidateReceipt(db, clock, {
          receiptId,
          action: 'project-create',
          payload: projectCreatePayload({ name, snapshot: first }),
          baseVersions: [],
        });
        if (!gate.ok) throw Object.assign(new Error(gate.code), { code: gate.code });
        if (db.prepare('SELECT 1 AS ok FROM projects WHERE id = ?').get(projectId)) return;
        db.prepare(
          `INSERT INTO projects
             (id, idempotency_key, at, payload_hash, origin, name, scene, created_at, approval_receipt_id, registry_change_id)
           VALUES (?, ?, ?, ?, ?, ?, 'work', ?, ?, NULL)`,
        ).run(
          projectId,
          businessKey,
          at,
          payloadHash({ name, snapshot: first, receiptId }),
          ownerOrigin,
          name,
          at,
          receiptId,
        );
        appendRelation(db, {
          type: 'project-update',
          payload: {
            projectId,
            baseRevision: 0,
            revision: 1,
            snapshot: first,
            evidence_refs: [],
            evidence_snapshots: [],
            origin: canonicalJson([ownerOrigin]),
            proof_scope: null,
            semantic_status: 'accepted',
            receiptId,
            changed_fields: SNAPSHOT_FIELDS.filter((field) => first[field] !== null),
            inherited_fields: [],
          },
          businessKey: canonicalJson([projectId, 1]),
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
        writeProjectState(
          db,
          projectId,
          {
            headRevision: 1,
            effectiveRevision: 1,
            snapshot: first,
            evidence_refs: [],
            evidence_snapshots: [],
            origin: canonicalJson([ownerOrigin]),
            validity: { valid: true, reason: null },
            completion: null,
          },
          1,
        );
        appendRelation(db, {
          type: 'registry-change',
          payload: { entity: { id: `entity:project:${projectId}`, name, kind: 'project' }, scopeId: projectId, receiptId },
          businessKey: `project:${projectId}`,
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
      }),
    readExact: () => {
      const stored = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      const state = readProjectState(db, projectId);
      if (!stored || !state || state.headRevision !== 1) {
        return { status: 'missing', reason: 'project_projection_missing' };
      }
      return { status: 'found', row: stored };
    },
  });
  if (receipt.status !== 'found') {
    return { ok: false, code: receipt.readback?.error ?? receipt.readback?.reason ?? 'readback_not_found' };
  }
  return { ok: true, projectId, revision, replayed: false };
}

/**
 * Full-snapshot update. Missing fields inherit old values AND old sources; an
 * explicit null clears; an identical value is treated as inherited (sources kept).
 */
export function updateProject(deps, { projectId, baseRevision = null, patch = {}, evidenceRefs = [], receiptId = null, requestId = null, semanticStatus = 'proposed', runtime = null }) {
  const { main: db, clock } = deps;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return { ok: false, code: 'project_missing' };
  const state = readProjectState(db, projectId);
  if (!state) return { ok: false, code: 'project_projection_missing' };
  const head = Number(state.headRevision);
  const incoming = validateSnapshotInput(patch);
  if (Object.keys(incoming).length === 0) {
    return { ok: false, code: 'validation_error', field: 'patch', rule: 'empty_update' };
  }
  const revision = head + 1;
  const rid = requestId ?? receiptId ?? `update-${revision}`;
  // Replay/conflict check runs before revision validation so a retried request
  // keeps its original result instead of turning into a stale error.
  const existing = db
    .prepare(
      `SELECT * FROM relations
       WHERE type = 'project-update' AND json_extract(payload, '$.projectId') = ?
         AND json_extract(payload, '$.requestId') = ?`,
    )
    .get(projectId, rid);
  if (existing) {
    const payload = JSON.parse(existing.payload);
    const previousRequest =
      payload.request_patch ??
      Object.fromEntries(
        Object.keys(incoming).map((key) => [key, payload.snapshot?.[key] ?? null]),
      );
    if (canonicalJson(previousRequest) !== canonicalJson(incoming)) {
      return { ok: false, code: 'validation_error', rule: 'same_request_conflicting_fields' };
    }
    return { ok: true, replayed: true, revision: Number(payload.revision) };
  }
  if (baseRevision !== null && Number(baseRevision) !== head) {
    return { ok: false, code: 'stale_project', headRevision: head };
  }
  if (receiptId !== null) {
    const verified = verifyReceiptBound(db, {
      receiptId,
      action: 'project-update',
      targetIds: [projectId],
      payload: { projectId, patch: incoming },
      baseVersions: [baseRevision ?? head],
    });
    if (!verified.ok) return verified;
  }

  const snapshot = {};
  const inherited = [];
  const changed = [];
  for (const field of SNAPSHOT_FIELDS) {
    const provided = Object.prototype.hasOwnProperty.call(incoming, field);
    const previous = state.snapshot?.[field] ?? null;
    if (!provided) {
      snapshot[field] = previous;
      inherited.push(field);
    } else if (incoming[field] === previous) {
      snapshot[field] = previous;
      inherited.push(field);
    } else {
      snapshot[field] = incoming[field];
      changed.push(field);
    }
  }

  if (projectTooLarge(project.name, snapshot)) {
    return { ok: false, code: 'project_capacity_blocked', reason: 'bytes_limit' };
  }
  const newDescriptors = evidenceRefs.map((ref) => describeEvidence(db, ref));
  const oldDescriptors = state.evidence_snapshots ?? [];
  const evidenceSnapshots = [...oldDescriptors, ...newDescriptors];
  const evidenceRefsAll = [...new Set([...(state.evidence_refs ?? []), ...evidenceRefs])];
  const originTokens = [
    ...new Set([
      ...parseOriginTokens(state.origin ?? '[]'),
      ...originTokensOf(db, evidenceRefs),
      ...(receiptId ? [`master@${clock.localDate()}`] : []),
      ...(runtime && !receiptId ? [modelOrigin(runtime), 'model_inference'] : []),
    ]),
  ].sort();
  const valid = isValid(db, evidenceSnapshots);
  const at = clock.at().at;

  const receipt = commit(deps, {
    objectKey: `main:${projectId}`,
    requestKey: `project-update:${projectId}:${revision}`,
    payload: { projectId, revision, snapshot, evidenceRefs: evidenceRefsAll, requestId: rid },
    targetIds: [projectId],
    writeTxn: () =>
      withImmediate(db, () => {
        if (receiptId !== null) {
          const gate = revalidateReceipt(db, clock, {
            receiptId,
            action: 'project-update',
            targetIds: [projectId],
            payload: { projectId, patch: incoming },
            baseVersions: [baseRevision ?? head],
          });
          if (!gate.ok) throw Object.assign(new Error(gate.code), { code: gate.code });
        }
        const replay = db
          .prepare(
            `SELECT * FROM relations WHERE type = 'project-update'
             AND json_extract(payload, '$.projectId') = ? AND json_extract(payload, '$.revision') = ?`,
          )
          .get(projectId, revision);
        if (replay) return;
        appendRelation(db, {
          type: 'project-update',
          payload: {
            projectId,
            baseRevision: head,
            revision,
            snapshot,
            evidence_refs: evidenceRefsAll,
            evidence_snapshots: evidenceSnapshots,
            origin: canonicalJson(originTokens),
            proof_scope: null,
            semantic_status: semanticStatus,
            receiptId,
            requestId: rid,
            changed_fields: changed,
            inherited_fields: inherited,
            request_patch: incoming,
          },
          businessKey: canonicalJson([projectId, revision]),
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
        writeProjectState(
          db,
          projectId,
          {
            headRevision: revision,
            effectiveRevision: valid ? revision : Number(state.effectiveRevision),
            snapshot,
            evidence_refs: evidenceRefsAll,
            evidence_snapshots: evidenceSnapshots,
            origin: canonicalJson(originTokens),
            validity: valid ? { valid: true, reason: null } : { valid: false, reason: 'evidence_invalid' },
            completion: state.completion ?? null,
          },
          revision,
        );
        if (receiptId) consumeReceipt(db, clock, receiptId);
      }),
    readExact: () => {
      const stored = readProjectState(db, projectId);
      if (!stored || stored.headRevision !== revision) {
        return { status: 'unknown', reason: 'project_projection_mismatch' };
      }
      const event = db
        .prepare(
          `SELECT 1 AS ok FROM relations WHERE type = 'project-update'
           AND json_extract(payload, '$.projectId') = ? AND json_extract(payload, '$.revision') = ?`,
        )
        .get(projectId, revision);
      if (!event) return { status: 'missing', reason: 'project_event_absent' };
      return { status: 'found', row: stored };
    },
  });
  if (receipt.status !== 'found') {
    return { ok: false, code: receipt.readback?.error ?? receipt.readback?.reason ?? 'readback_not_found' };
  }
  return { ok: true, revision, snapshot, inherited, changed, valid };
}

/** Owner-bound project selection; the work window may then show the Overview. */
export function selectProject(deps, { sessionId, projectId, receiptId }) {
  const { main: db, clock } = deps;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return { ok: false, code: 'project_missing' };
  const state = readProjectState(db, projectId);
  const headRevision = state?.headRevision ?? 1;
  const verified = verifyReceiptBound(db, {
    receiptId,
    action: 'project-select',
    targetIds: [projectId],
    payload: projectSelectPayload({ projectId, revision: headRevision, sessionId }),
    baseVersions: [headRevision],
  });
  if (!verified.ok) return verified;
  const at = clock.at().at;
  const receipt = commit(deps, {
    objectKey: `main:active_project:${sessionId}`,
    requestKey: `project-select:${receiptId}`,
    payload: { sessionId, projectId, revision: state?.headRevision ?? 1, receiptId },
    targetIds: [projectId],
    writeTxn: () =>
      withImmediate(db, () => {
        const gate = revalidateReceipt(db, clock, {
          receiptId,
          action: 'project-select',
          targetIds: [projectId],
          payload: projectSelectPayload({ projectId, revision: headRevision, sessionId }),
          baseVersions: [headRevision],
        });
        if (!gate.ok) throw Object.assign(new Error(gate.code), { code: gate.code });
        putState(
          db,
          activeKey(sessionId),
          { projectId, revision: state?.headRevision ?? 1, selectionReceiptId: receiptId },
          state?.headRevision ?? 1,
        );
        appendRelation(db, {
          type: 'project-select',
          payload: {
            sessionId,
            projectId,
            revision: state?.headRevision ?? 1,
            receiptId,
          },
          businessKey: canonicalJson([sessionId, receiptId]),
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
      }),
    readExact: () => {
      const active = getState(db, activeKey(sessionId))?.value;
      return active && active.projectId === projectId
        ? { status: 'found', row: active }
        : { status: 'missing', reason: 'active_project_missing' };
    },
  });
  if (receipt.status !== 'found') return { ok: false, code: receipt.readback?.error ?? receipt.readback?.reason ?? 'readback_not_found' };
  return { ok: true, projectId, revision: state?.headRevision ?? 1 };
}

/** Owner-bound completion of the exact current snapshot; text never verifies it. */
export function completeProject(deps, { projectId, receiptId }) {
  const { main: db, clock } = deps;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return { ok: false, code: 'project_missing' };
  const state = readProjectState(db, projectId);
  if (!state) return { ok: false, code: 'project_projection_missing' };
  const snapshotHash = payloadHash(state.snapshot);
  const verified = verifyReceiptBound(db, {
    receiptId,
    action: 'project-complete',
    targetIds: [projectId],
    payload: projectCompletePayload({ projectId, revision: state.headRevision, snapshotHash }),
    baseVersions: [state.headRevision],
  });
  if (!verified.ok) return verified;
  const at = clock.at().at;
  const receipt = commit(deps, {
    objectKey: `main:${projectId}`,
    requestKey: `project-complete:${receiptId}`,
    payload: { projectId, revision: state.headRevision, snapshotHash, receiptId },
    targetIds: [projectId],
    writeTxn: () =>
      withImmediate(db, () => {
        const gate = revalidateReceipt(db, clock, {
          receiptId,
          action: 'project-complete',
          targetIds: [projectId],
          payload: projectCompletePayload({ projectId, revision: state.headRevision, snapshotHash }),
          baseVersions: [state.headRevision],
        });
        if (!gate.ok) throw Object.assign(new Error(gate.code), { code: gate.code });
        appendRelation(db, {
          type: 'project-complete',
          payload: { projectId, revision: state.headRevision, snapshotHash, receiptId },
          businessKey: canonicalJson([projectId, receiptId]),
          at,
          keyEncoding: 'canonical',
          eventVersion: '2',
          payloadVersion: '2',
        });
        writeProjectState(
          db,
          projectId,
          {
            ...state,
            completion: { revision: state.headRevision, snapshotHash, receiptId, verified: true },
          },
          state.headRevision,
        );
      }),
    readExact: () => {
      const stored = readProjectState(db, projectId);
      return stored?.completion?.verified
        ? { status: 'found', row: stored }
        : { status: 'missing', reason: 'completion_projection_missing' };
    },
  });
  if (receipt.status !== 'found') return { ok: false, code: receipt.readback?.error ?? receipt.readback?.reason ?? 'readback_not_found' };
  return { ok: true, revision: state.headRevision, snapshotHash };
}

/**
 * Read-only effective Overview. Invalid evidence makes a version fall back to
 * the last valid revision; headRevision never moves backwards.
 */
export function projectOverview(db, { projectId }) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const state = readProjectState(db, projectId);
  const events = db
    .prepare(
      `SELECT * FROM relations WHERE type = 'project-update'
       AND json_extract(payload, '$.projectId') = ? ORDER BY json_extract(payload, '$.revision') ASC`,
    )
    .all(projectId)
    .map((relation) => ({ relation, payload: JSON.parse(relation.payload) }));
  let effective = null;
  for (const event of events) {
    if (isValid(db, event.payload.evidence_snapshots ?? [])) {
      effective = event.payload;
    }
  }
  if (!effective && events.length > 0) effective = events[0].payload;
  const head = state?.headRevision ?? (events.length > 0 ? Number(events[events.length - 1].payload.revision) : 1);
  const completion = state?.completion ?? null;
  const completionVerified = Boolean(
    completion &&
      completion.verified &&
      Number(completion.revision) === Number(effective?.revision ?? head) &&
      completion.snapshotHash === payloadHash(effective?.snapshot ?? state?.snapshot ?? {}),
  );
  return {
    projectId,
    name: project.name,
    scene: project.scene,
    headRevision: head,
    effectiveRevision: Number(effective?.revision ?? head),
    snapshot: effective?.snapshot ?? state?.snapshot ?? null,
    evidence_refs: effective?.evidence_refs ?? state?.evidence_refs ?? [],
    origin: effective?.origin ?? state?.origin ?? null,
    validity: (() => {
      const headEvent = events.length > 0 ? events[events.length - 1].payload : null;
      const headValid = isValid(db, headEvent?.evidence_snapshots ?? []);
      return headValid ? { valid: true, reason: null } : { valid: false, reason: 'evidence_invalid' };
    })(),
    completion: { verified: completionVerified, revision: completion?.revision ?? null },
    model_reported_complete:
      typeof (effective?.snapshot?.progress ?? '') === 'string' &&
      (effective?.snapshot?.progress ?? '').includes('完成'),
    requested_revision: head,
  };
}

export function activeProjectOf(db, sessionId) {
  return getState(db, activeKey(sessionId))?.value ?? null;
}

/** Rebuild the projection from project-update events (read-only in normal use). */
export function rebuildProjection(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const events = db
    .prepare(
      `SELECT * FROM relations WHERE type = 'project-update'
       AND json_extract(payload, '$.projectId') = ? ORDER BY json_extract(payload, '$.revision') ASC`,
    )
    .all(projectId)
    .map((relation) => JSON.parse(relation.payload));
  if (events.length === 0) return null;
  let state = null;
  for (const payload of events) {
    const valid = isValid(db, payload.evidence_snapshots ?? []);
    state = {
      headRevision: Number(payload.revision),
      effectiveRevision: valid ? Number(payload.revision) : Number(state?.effectiveRevision ?? payload.revision),
      snapshot: payload.snapshot,
      evidence_refs: payload.evidence_refs,
      evidence_snapshots: payload.evidence_snapshots,
      origin: payload.origin,
      validity: valid ? { valid: true, reason: null } : { valid: false, reason: 'evidence_invalid' },
      completion: state?.completion ?? null,
    };
  }
  return state;
}

export { buildStateSnapshot, initialStrength, getRelationByDedupe };
