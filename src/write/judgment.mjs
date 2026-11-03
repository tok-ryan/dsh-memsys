import { canonicalJson, kindBusinessKey, keys, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactObservation } from '../control/readback.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getObservation,
  getRelationByDedupe,
  insertObservation,
} from '../storage/repositories.mjs';
import {
  WriteError,
  assertModelAuthor,
  assertNoForbiddenFields,
  modelOrigin,
  stripAuditTimes,
} from './authority.mjs';
import { parseOriginTokens } from './origin.mjs';
import { resolveTopic } from './topic.mjs';
import { foldJudgmentVerdicts } from '../storage/replay.mjs';

export const VERDICT_RESULTS = Object.freeze(['right', 'wrong', 'pending', 'unverified']);
export const OUTCOMES = Object.freeze(['pending', 'done', 'reverted', 'failed']);
export const OUTCOME_TRANSITIONS = Object.freeze({
  pending: ['done', 'failed', 'reverted'],
  done: ['reverted'],
  failed: ['pending', 'reverted'],
  reverted: ['pending'],
});

const REF_TABLES = Object.freeze({
  obs_: 'observations',
  cand_: 'candidates',
  mem_: 'memories',
  sn_: 'self_notes',
  jdg_: 'judgments',
  spec_: 'speculations',
});

function refTable(id) {
  for (const [prefix, table] of Object.entries(REF_TABLES)) {
    if (id.startsWith(prefix)) return table;
  }
  return null;
}

function verifyRefs(db, refs, field = 'evidence_refs') {
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new WriteError('validation_error', { field });
    }
    const table = refTable(ref);
    if (!table) throw new WriteError('validation_error', { field, ref });
    const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).get(ref);
    if (!row) throw new WriteError('validation_error', { field, ref });
  }
}

function refOrigins(db, refs) {
  const tokens = [];
  for (const ref of refs) {
    const table = refTable(ref);
    if (!table) continue;
    const row = db.prepare(`SELECT origin FROM ${table} WHERE id = ?`).get(ref);
    if (row) tokens.push(...parseOriginTokens(row.origin));
  }
  return [...new Set(tokens)].sort();
}

function scopeIdOf(runtime) {
  return runtime.mode ?? runtime.phase ?? 'work';
}

function ensureModelObservation(runtime, clock, { text, callId, slot }, deps) {
  const businessKey = keys.observationModel(runtime.sessionId, callId, slot);
  const observationId = objectId('obs', businessKey);
  const existing = getObservation(deps.main, observationId);
  if (existing) return existing;
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
  return receipt.status === 'found' ? stored : null;
}

export function readJudgmentState(db, judgmentId) {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(`judgment:${judgmentId}`);
  const base = { outcome: null, outcomeRevision: 0, verdict: null, needsReview: false, unreviewed: false };
  return row ? { ...base, ...JSON.parse(row.value) } : base;
}

export function writeJudgmentState(db, judgmentId, state, revision) {
  db.prepare(
    `INSERT INTO state (key, value, source_revision) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, source_revision = excluded.source_revision`,
  ).run(`judgment:${judgmentId}`, JSON.stringify(state), revision);
}

function assertJudgmentFields(item) {
  if (typeof item.verdict_text !== 'string' || item.verdict_text.length === 0) {
    throw new WriteError('validation_error', { field: 'verdict_text' });
  }
  if (typeof item.basis !== 'string' || item.basis.length === 0) {
    throw new WriteError('validation_error', { field: 'basis' });
  }
  if (typeof item.falsifier !== 'string' || item.falsifier.length === 0) {
    throw new WriteError('validation_error', { field: 'falsifier' });
  }
  const outcome = item.outcome ?? 'pending';
  if (!OUTCOMES.includes(outcome)) throw new WriteError('validation_error', { field: 'outcome' });
  const proofScope = item.proof_scope ?? item.proofScope ?? null;
  if (outcome === 'done' && !proofScope) {
    throw new WriteError('validation_error', { field: 'proof_scope', rule: 'done_requires_proof' });
  }
  return { outcome, proofScope };
}

/** B2 judgment: original ruling, evidence and topic, never rewritten. */
export function recordJudgments(runtime, request, deps) {
  assertModelAuthor(runtime);
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  return {
    items: items.map((item, slot) => recordJudgmentOne(runtime, item, slot, request, deps)),
  };
}

function recordJudgmentOne(runtime, item, slot, request, deps) {
  const { main: db, clock } = deps;
  try {
    const { item: clean, violations } = stripAuditTimes(item ?? {});
    assertNoForbiddenFields(clean);
    const { outcome, proofScope } = assertJudgmentFields(clean);
    const evidenceRefs = clean.evidence_refs ?? clean.evidenceRefs ?? [];
    if (!Array.isArray(evidenceRefs)) throw new WriteError('validation_error', { field: 'evidence_refs' });
    verifyRefs(db, evidenceRefs);
    const callId = runtime.callId;
    const businessKey = kindBusinessKey('judgment', callId, slot);
    const id = objectId('jdg', businessKey);
    const payload = {
      verdict_text: clean.verdict_text,
      basis: clean.basis,
      falsifier: clean.falsifier,
      evidence_refs: evidenceRefs,
      outcome,
      proof_scope: proofScope,
      phase: clean.phase ?? runtime.phase ?? null,
    };
    const existing = db.prepare('SELECT * FROM judgments WHERE idempotency_key = ?').get(businessKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash(payload)) {
        return { slot, error: 'idempotency_conflict' };
      }
      return { slot, id: existing.id, status: 'found', replayed: true };
    }
    const topic = resolveTopic(db, clean.topic_components ?? clean.topicComponents ?? null, {
      scopeId: scopeIdOf(runtime),
      observationId: id,
      sourceUnit: 'judgment',
    });
    const observation = ensureModelObservation(
      runtime,
      clock,
      { text: clean.verdict_text, callId, slot },
      deps,
    );
    if (!observation) return { slot, error: 'observation_write_failed' };
    const at = clock.at().at;
    const originTokens = [...refOrigins(db, evidenceRefs), modelOrigin(runtime), 'model_inference'];
    const row = {
      id,
      idempotency_key: businessKey,
      at,
      payload_hash: payloadHash(payload),
      observation_id: observation.id,
      phase: clean.phase ?? runtime.phase ?? null,
      verdict_text: clean.verdict_text,
      basis: clean.basis,
      falsifier: clean.falsifier,
      evidence_refs: canonicalJson(evidenceRefs),
      evidence_origin: canonicalJson(refOrigins(db, evidenceRefs)),
      topic_key: topic.topicKey,
      topic_components: topic.components ? canonicalJson(topic.components) : null,
      registry_revision: topic.registryRevision,
      key_status: topic.keyStatus,
      binding_status: topic.bindingStatus,
      binding_basis: canonicalJson({ ruleRevision: 'topic-v1', components: topic.components }),
      outcome,
      proof_scope: proofScope ? canonicalJson(proofScope) : null,
      origin: canonicalJson([...new Set(originTokens)].sort()),
      state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
      initial_strength: initialStrength(),
    };
    const writeTxn = () =>
      withImmediate(db, () => {
        if (db.prepare('SELECT 1 AS ok FROM judgments WHERE id = ?').get(id)) return;
        db.prepare(
          `INSERT INTO judgments
             (id, idempotency_key, at, payload_hash, observation_id, phase, verdict_text, basis,
              falsifier, evidence_refs, evidence_origin, topic_key, topic_components,
              registry_revision, key_status, binding_status, binding_basis, outcome, proof_scope,
              origin, state_snapshot, initial_strength)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          row.id, row.idempotency_key, row.at, row.payload_hash, row.observation_id, row.phase,
          row.verdict_text, row.basis, row.falsifier, row.evidence_refs, row.evidence_origin,
          row.topic_key, row.topic_components, row.registry_revision, row.key_status,
          row.binding_status, row.binding_basis, row.outcome, row.proof_scope, row.origin,
          row.state_snapshot, row.initial_strength,
        );
        writeJudgmentState(
          db,
          id,
          { outcome, outcomeRevision: 0, verdict: null, needsReview: false, unreviewed: false },
          0,
        );
        if (violations.length > 0) {
          appendRelation(db, {
            type: 'violation',
            payload: { kind: 'audit_time_rejected', fields: violations, sessionId: runtime.sessionId },
            businessKey: `${id}:${violations.join(',')}`,
            at,
          });
        }
      });
    const readExact = () => {
      const stored = db.prepare('SELECT * FROM judgments WHERE id = ?').get(id);
      if (!stored) return { status: 'missing', reason: 'judgment_absent' };
      for (const field of ['id', 'payload_hash', 'verdict_text', 'basis', 'falsifier', 'outcome']) {
        if (stored[field] !== row[field]) return { status: 'unknown', reason: 'field_mismatch', field };
      }
      const projection = readJudgmentState(db, id);
      if (projection.outcome !== outcome) {
        return { status: 'unknown', reason: 'projection_mismatch' };
      }
      return { status: 'found', row: stored };
    };
    const receipt = commitControlled({
      control: deps.control,
      clock,
      spec: {
        objectKey: `main:${id}`,
        targetDb: 'main',
        requestKey: `judgment:${businessKey}`,
        payloadHash: row.payload_hash,
        immutablePayload: canonicalJson(payload),
        targetIds: [id, observation.id],
        hooks: deps.commitHooks ?? {},
      },
      writeTxn,
      readExact,
    });
    if (receipt.status !== 'found') {
      return { slot, id, status: receipt.status, error: receipt.readback?.reason ?? 'readback_not_found' };
    }
    return { slot, id, status: 'found', replayed: false };
  } catch (err) {
    if (err instanceof WriteError) return { slot, error: err.code, detail: err.detail ?? null, message: err.message };
    return { slot, error: err.code ?? 'write_failed', message: err.message };
  }
}

/** B2 speculation: explicit inference chain; never auto-injected. */
export function recordSpeculations(runtime, request, deps) {
  assertModelAuthor(runtime);
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  return { items: items.map((item, slot) => recordSpeculationOne(runtime, item, slot, deps)) };
}

function recordSpeculationOne(runtime, item, slot, deps) {
  const { main: db, clock } = deps;
  try {
    const { item: clean, violations } = stripAuditTimes(item ?? {});
    assertNoForbiddenFields(clean);
    for (const field of ['text', 'basis', 'falsifier']) {
      if (typeof clean[field] !== 'string' || clean[field].length === 0) {
        throw new WriteError('validation_error', { field });
      }
    }
    const basisRefs = clean.basis_refs ?? clean.basisRefs ?? [];
    const linked = clean.linked_judgment_ids ?? clean.linkedJudgmentIds ?? [];
    if (!Array.isArray(basisRefs) || !Array.isArray(linked)) {
      throw new WriteError('validation_error', { field: 'basis_refs' });
    }
    verifyRefs(db, basisRefs, 'basis_refs');
    verifyRefs(db, linked, 'linked_judgment_ids');
    for (const id of linked) {
      if (!id.startsWith('jdg_')) throw new WriteError('validation_error', { field: 'linked_judgment_ids' });
    }
    const callId = runtime.callId;
    const businessKey = kindBusinessKey('speculation', callId, slot);
    const id = objectId('spec', businessKey);
    const payload = {
      text: clean.text,
      basis: clean.basis,
      falsifier: clean.falsifier,
      basis_refs: basisRefs,
      linked_judgment_ids: linked,
    };
    const existing = db.prepare('SELECT * FROM speculations WHERE idempotency_key = ?').get(businessKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash(payload)) return { slot, error: 'idempotency_conflict' };
      return { slot, id: existing.id, status: 'found', replayed: true };
    }
    const observation = ensureModelObservation(runtime, clock, { text: clean.text, callId, slot }, deps);
    if (!observation) return { slot, error: 'observation_write_failed' };
    const at = clock.at().at;
    const row = {
      id,
      idempotency_key: businessKey,
      at,
      payload_hash: payloadHash(payload),
      observation_id: observation.id,
      text: clean.text,
      basis: clean.basis,
      falsifier: clean.falsifier,
      basis_refs: canonicalJson(basisRefs),
      linked_judgment_ids: canonicalJson(linked),
      origin: canonicalJson([...new Set([...refOrigins(db, basisRefs), modelOrigin(runtime), 'model_inference'])].sort()),
      state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
      initial_strength: initialStrength(),
    };
    const receipt = commitControlled({
      control: deps.control,
      clock,
      spec: {
        objectKey: `main:${id}`,
        targetDb: 'main',
        requestKey: `speculation:${businessKey}`,
        payloadHash: row.payload_hash,
        immutablePayload: canonicalJson(payload),
        targetIds: [id, observation.id],
        hooks: deps.commitHooks ?? {},
      },
      writeTxn: () =>
        withImmediate(db, () => {
          if (db.prepare('SELECT 1 AS ok FROM speculations WHERE id = ?').get(id)) return;
          db.prepare(
            `INSERT INTO speculations
               (id, idempotency_key, at, payload_hash, observation_id, text, basis, falsifier,
                basis_refs, linked_judgment_ids, origin, state_snapshot, initial_strength)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            row.id, row.idempotency_key, row.at, row.payload_hash, row.observation_id, row.text,
            row.basis, row.falsifier, row.basis_refs, row.linked_judgment_ids, row.origin,
            row.state_snapshot, row.initial_strength,
          );
          if (violations.length > 0) {
            appendRelation(db, {
              type: 'violation',
              payload: { kind: 'audit_time_rejected', fields: violations, sessionId: runtime.sessionId },
              businessKey: `${id}:${violations.join(',')}`,
              at,
            });
          }
        }),
      readExact: () => {
        const stored = db.prepare('SELECT * FROM speculations WHERE id = ?').get(id);
        if (!stored) return { status: 'missing', reason: 'speculation_absent' };
        if (stored.text !== row.text || stored.payload_hash !== row.payload_hash) {
          return { status: 'unknown', reason: 'field_mismatch' };
        }
        return { status: 'found', row: stored };
      },
    });
    if (receipt.status !== 'found') {
      return { slot, id, status: receipt.status, error: receipt.readback?.reason ?? 'readback_not_found' };
    }
    return { slot, id, status: 'found', replayed: false };
  } catch (err) {
    if (err instanceof WriteError) return { slot, error: err.code, detail: err.detail ?? null };
    return { slot, error: err.code ?? 'write_failed', message: err.message };
  }
}

/** B2 outcome change: action result only; verdict is a separate ledger. */
export function recordOutcomeChange(runtime, request, deps) {
  assertModelAuthor(runtime);
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  return {
    items: items.map((item, slot) => recordOutcomeOne(runtime, item, slot, request, deps)),
  };
}

function recordOutcomeOne(runtime, item, slot, request, deps) {
  const { main: db, clock } = deps;
  try {
    const { item: clean } = stripAuditTimes(item ?? {});
    const judgmentId = clean.judgmentId;
    const judgment = db.prepare('SELECT * FROM judgments WHERE id = ?').get(judgmentId);
    if (!judgment) throw new WriteError('validation_error', { field: 'judgmentId' });
    const state = readJudgmentState(db, judgmentId);
    const currentOutcome = state.outcome ?? judgment.outcome;
    const from = clean.from;
    const to = clean.to;
    if (!OUTCOMES.includes(to)) throw new WriteError('validation_error', { field: 'to' });
    const requestId = runtime.requestId ?? runtime.callId;
    const businessKey = canonicalJson([judgmentId, requestId, slot]);
    const dedupeKey = canonicalJson(['outcome-change', businessKey]);
    const requestCompare = {
      judgmentId,
      from,
      to,
      why: clean.why,
      evidence_refs: clean.evidence_refs ?? clean.evidenceRefs ?? [],
      proof_scope: clean.proof_scope ?? clean.proofScope ?? null,
    };
    const existingEvent = getRelationByDedupe(db, dedupeKey);
    if (existingEvent) {
      const stored = JSON.parse(existingEvent.payload);
      const storedCompare = {
        judgmentId: stored.judgmentId,
        from: stored.from,
        to: stored.to,
        why: stored.why,
        evidence_refs: stored.evidence_refs,
        proof_scope: stored.proof_scope,
      };
      if (canonicalJson(storedCompare) !== canonicalJson(requestCompare)) {
        return { slot, error: 'idempotency_conflict' };
      }
      return { slot, status: 'found', replayed: true, outcome: stored.to };
    }
    if (from !== currentOutcome) {
      return { slot, error: 'stale_outcome', currentRevision: state.outcomeRevision, currentOutcome };
    }
    if (Number(clean.baseRevision ?? state.outcomeRevision) !== state.outcomeRevision) {
      return { slot, error: 'stale_outcome', currentRevision: state.outcomeRevision, currentOutcome };
    }
    if (to === currentOutcome) return { slot, error: 'no_state_change' };
    if (!(OUTCOME_TRANSITIONS[currentOutcome] ?? []).includes(to)) {
      return { slot, error: 'invalid_transition', from: currentOutcome, to };
    }
    if (to === 'done') {
      const scope = clean.proof_scope ?? clean.proofScope;
      if (!scope || typeof scope !== 'object' || !scope.operationId || !scope.resultRef) {
        return { slot, error: 'validation_error', field: 'proof_scope' };
      }
    }
    if (typeof clean.why !== 'string' || clean.why.length === 0) {
      return { slot, error: 'validation_error', field: 'why' };
    }
    const payload = {
      judgmentId,
      baseRevision: state.outcomeRevision,
      from: currentOutcome,
      to,
      why: clean.why,
      evidence_refs: clean.evidence_refs ?? clean.evidenceRefs ?? [],
      proof_scope: clean.proof_scope ?? clean.proofScope ?? null,
      semantic_status: 'proposed',
      requestId,
      itemSlot: slot,
    };
    const at = clock.at().at;
    let relationId = null;
    const receipt = commitControlled({
      control: deps.control,
      clock,
      spec: {
        objectKey: `main:judgment:${judgmentId}`,
        targetDb: 'main',
        requestKey: `outcome:${businessKey}`,
        payloadHash: payloadHash(payload),
        immutablePayload: canonicalJson(payload),
        targetIds: [judgmentId],
        hooks: deps.commitHooks ?? {},
      },
      writeTxn: () =>
        withImmediate(db, () => {
          const replay = getRelationByDedupe(db, dedupeKey);
          if (replay) {
            relationId = replay.id;
            return;
          }
          const event = appendRelation(db, {
            type: 'outcome-change',
            payload,
            businessKey,
            at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          });
          relationId = event.id;
          const nextState = { ...state, outcome: to, outcomeRevision: state.outcomeRevision + 1 };
          writeJudgmentState(db, judgmentId, nextState, nextState.outcomeRevision);
        }),
      readExact: () => {
        const stored = readJudgmentState(db, judgmentId);
        if (stored.outcome !== to) return { status: 'unknown', reason: 'outcome_projection_mismatch' };
        const relation = getRelationByDedupe(db, dedupeKey);
        if (!relation) return { status: 'missing', reason: 'event_absent' };
        return { status: 'found', row: relation };
      },
    });
    if (receipt.status !== 'found') {
      return { slot, status: receipt.status, error: receipt.readback?.reason ?? 'readback_not_found' };
    }
    return { slot, status: 'found', outcome: to, eventId: relationId };
  } catch (err) {
    if (err instanceof WriteError) return { slot, error: err.code, detail: err.detail ?? null };
    return { slot, error: err.code ?? 'write_failed', message: err.message };
  }
}

const BY_LAYER = { master: 3, self: 2, auto: 1 };

/** Effective verdict: shared fold (master > self > auto, then latest). */
export function effectiveVerdict(relations, judgmentId) {
  return foldJudgmentVerdicts(relations, judgmentId);
}

export function _legacyEffectiveVerdict(relations, judgmentId) {
  const voided = new Set();
  for (const relation of relations) {
    if (relation.type !== 'verdict-void') continue;
    const payload = JSON.parse(relation.payload);
    voided.add(payload.verdictId);
  }
  let best = null;
  for (const relation of relations) {
    if (relation.type !== 'verdict') continue;
    const payload = JSON.parse(relation.payload);
    if (payload.judgmentId !== judgmentId) continue;
    if (voided.has(relation.id)) continue;
    const candidate = {
      id: relation.id,
      by: payload.by,
      result: payload.result,
      at: relation.at,
      commitSeq: Number(relation.commit_seq),
      ordinal: Number(relation.ordinal ?? 0),
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const layerDiff = (BY_LAYER[candidate.by] ?? 0) - (BY_LAYER[best.by] ?? 0);
    if (layerDiff > 0) best = candidate;
    else if (layerDiff === 0) {
      const newer =
        candidate.commitSeq > best.commitSeq ||
        (candidate.commitSeq === best.commitSeq && candidate.ordinal > best.ordinal);
      if (newer) best = candidate;
    }
  }
  return best;
}

export function recordVerdict(runtime, request, deps) {
  assertModelAuthor(runtime);
  const items = request?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new WriteError('validation_error', { field: 'items', rule: '1..20' });
  }
  return { items: items.map((item, slot) => recordVerdictOne(runtime, item, slot, deps)) };
}

function recordVerdictOne(runtime, item, slot, deps) {
  const { main: db, clock } = deps;
  try {
    const clean = item ?? {};
    const judgmentId = clean.judgmentId;
    const judgment = db.prepare('SELECT * FROM judgments WHERE id = ?').get(judgmentId);
    if (!judgment) return { slot, error: 'validation_error', field: 'judgmentId' };
    const by = clean.by ?? 'self';
    if (!['self', 'auto'].includes(by)) {
      return { slot, error: 'unsupported_in_batch', field: 'by', rule: 'master_requires_receipt' };
    }
    const result = clean.result;
    if (!VERDICT_RESULTS.includes(result)) return { slot, error: 'validation_error', field: 'result' };
    if (by === 'self' && result === 'right') {
      return { slot, error: 'validation_error', field: 'result', rule: 'self_cannot_be_right' };
    }
    const relations = db
      .prepare('SELECT * FROM relations ORDER BY commit_seq, ordinal, id')
      .all();
    const current = effectiveVerdict(relations, judgmentId);
    if (current && current.by === 'master' && by !== 'master') {
      return { slot, error: 'invalid_transition', rule: 'master_verdict_untouchable' };
    }
    const requestId = runtime.requestId ?? runtime.callId;
    const businessKey = canonicalJson([judgmentId, requestId, slot]);
    const dedupeKey = canonicalJson(['verdict', businessKey]);
    const payload = {
      judgmentId,
      by,
      result,
      basis: clean.basis ?? '',
      falsifier: clean.falsifier ?? '',
      evidence_refs: clean.evidence_refs ?? clean.evidenceRefs ?? [],
      evidenceOrigin: judgment.evidence_origin,
      requestId,
      itemSlot: slot,
    };
    const existing = getRelationByDedupe(db, dedupeKey);
    if (existing) {
      if (canonicalJson(JSON.parse(existing.payload)) !== canonicalJson(payload)) {
        return { slot, error: 'idempotency_conflict' };
      }
      return { slot, status: 'found', replayed: true };
    }
    const at = clock.at().at;
    let eventId = null;
    const receipt = commitControlled({
      control: deps.control,
      clock,
      spec: {
        objectKey: `main:judgment:${judgmentId}`,
        targetDb: 'main',
        requestKey: `verdict:${businessKey}`,
        payloadHash: payloadHash(payload),
        immutablePayload: canonicalJson(payload),
        targetIds: [judgmentId],
        hooks: deps.commitHooks ?? {},
      },
      writeTxn: () =>
        withImmediate(db, () => {
          if (getRelationByDedupe(db, dedupeKey)) return;
          const event = appendRelation(db, {
            type: 'verdict',
            payload,
            businessKey,
            at,
            keyEncoding: 'canonical',
            eventVersion: '2',
            payloadVersion: '2',
          });
          eventId = event.id;
          const state = readJudgmentState(db, judgmentId);
          writeJudgmentState(
            db,
            judgmentId,
            { ...state, verdict: { id: event.id, by, result, at } },
            state.outcomeRevision,
          );
        }),
      readExact: () => {
        const relation = getRelationByDedupe(db, dedupeKey);
        if (!relation) return { status: 'missing', reason: 'event_absent' };
        const state = readJudgmentState(db, judgmentId);
        if (!state.verdict || state.verdict.id !== relation.id) {
          return { status: 'unknown', reason: 'verdict_projection_mismatch' };
        }
        return { status: 'found', row: relation };
      },
    });
    if (receipt.status !== 'found') {
      return { slot, status: receipt.status, error: receipt.readback?.reason ?? 'readback_not_found' };
    }
    return { slot, status: 'found', by, result, eventId };
  } catch (err) {
    if (err instanceof WriteError) return { slot, error: err.code, detail: err.detail ?? null };
    return { slot, error: err.code ?? 'write_failed', message: err.message };
  }
}

/**
 * Trusted tool wrapper outcome. Not exposed in the model schema: the wrapper
 * binds operationId + judgmentId before running, then reports the real exit.
 */
export function recordRegisteredToolOutcome({ operationId, judgmentId, exitCode, resultRef, resultHash }, deps) {
  const { main: db, clock } = deps;
  const judgment = db.prepare('SELECT * FROM judgments WHERE id = ?').get(judgmentId);
  if (!judgment) throw new WriteError('validation_error', { field: 'judgmentId' });
  const state = readJudgmentState(db, judgmentId);
  const from = state.outcome ?? judgment.outcome;
  const to = exitCode === 0 ? 'done' : 'failed';
  const proofScope = {
    kind: 'command',
    operationId,
    resultRef,
    resultHash,
    ruleRevision: 'registered-tool-v1',
  };
  const runtime = { ...deps.runtime, callId: `tool:${operationId}`, requestId: `tool:${operationId}` };
  return recordOutcomeChange(
    runtime,
    {
      items: [
        {
          judgmentId,
          baseRevision: state.outcomeRevision,
          from,
          to,
          why: `registered tool result exit=${exitCode}`,
          evidence_refs: [resultRef],
          proof_scope: proofScope,
        },
      ],
    },
    deps,
  );
}

export { ensureModelObservation };
