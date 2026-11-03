import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactObservation } from '../control/readback.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getMemory,
  getObservation,
  insertObservation,
} from '../storage/repositories.mjs';
import { modelOrigin, WriteError } from '../write/authority.mjs';
import { parseOriginTokens } from '../write/origin.mjs';

const LINK_TABLES = Object.freeze({
  obs_: 'observations',
  cand_: 'candidates',
  mem_: 'memories',
  sn_: 'self_notes',
  jdg_: 'judgments',
  spec_: 'speculations',
});

export const DREAM_STATUS = Object.freeze(['inferred', 'dead']);

export function assertDreamRole(runtime) {
  if (!runtime || runtime.role !== 'dream') {
    throw new WriteError('forbidden_role', { role: runtime?.role ?? null });
  }
  if (!runtime.sessionId || !runtime.callId) {
    throw new WriteError('runtime_identity_unavailable');
  }
  return runtime;
}

function dreamNextSeq(dream) {
  const row = dream.prepare('SELECT COALESCE(MAX(commit_seq), 0) + 1 AS seq FROM relations').get();
  return Number(row.seq);
}

function appendDreamRelation(dream, clock, { type, payload, businessKey, at }) {
  const dedupeKey = canonicalJson([type, businessKey]);
  const existing = dream.prepare('SELECT * FROM relations WHERE dedupe_key = ?').get(dedupeKey);
  if (existing) {
    const same = canonicalJson(JSON.parse(existing.payload)) === canonicalJson(payload);
    if (!same) {
      const err = new Error('idempotency_conflict');
      err.code = 'idempotency_conflict';
      throw err;
    }
    return { id: existing.id, commitSeq: Number(existing.commit_seq), replayed: true };
  }
  const id = payloadHash({ dream: true, dedupeKey });
  const commitSeq = dreamNextSeq(dream);
  dream
    .prepare(
      `INSERT INTO relations (id, type, payload, dedupe_key, at, commit_seq, ordinal, event_version, payload_version)
       VALUES (?, ?, ?, ?, ?, ?, 0, '2', '2')`,
    )
    .run(id, type, canonicalJson(payload), dedupeKey, at, commitSeq);
  return { id, commitSeq, replayed: false };
}

function verifyLink(main, dream, id) {
  if (typeof id !== 'string' || id.length === 0) throw new WriteError('validation_error', { field: 'linkedIds' });
  if (/^d-[A-Za-z0-9]+#p\d+$/.test(id)) {
    const dreamRow = dream.prepare('SELECT proposition_id FROM propositions WHERE id = ?').get(id.split('#')[0]);
    return { id, kind: 'dream_proposition', row: dreamRow };
  }
  for (const [prefix, table] of Object.entries(LINK_TABLES)) {
    if (!id.startsWith(prefix)) continue;
    const row = main.prepare(`SELECT id, origin FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new WriteError('validation_error', { field: 'linkedIds', id, reason: 'missing' });
    return { id, kind: table, row };
  }
  throw new WriteError('validation_error', { field: 'linkedIds', id, reason: 'unknown_type' });
}

function ensureModelObservation(runtime, clock, { text, callId, slot }, deps) {
  const businessKey = `obs:model:${runtime.sessionId}:${callId}:${slot}`;
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

/**
 * Dream write: original output is preserved in the main library, then one dream
 * transaction writes dream + propositions + inferred candidates + event.
 */
export function recordDream(deps, { runtime, item }) {
  assertDreamRole(runtime);
  const { main, dream, clock } = deps;
  const linkedIds = item?.linkedIds ?? [];
  const propositions = item?.propositions ?? [];
  if (!Array.isArray(linkedIds) || linkedIds.length > 20) {
    throw new WriteError('validation_error', { field: 'linkedIds' });
  }
  if (!Array.isArray(propositions) || propositions.length < 1 || propositions.length > 20) {
    throw new WriteError('validation_error', { field: 'propositions' });
  }
  if (typeof item?.idea !== 'string' || item.idea.length === 0) {
    throw new WriteError('validation_error', { field: 'idea' });
  }
  if (typeof item?.basis !== 'string' || item.basis.length === 0) {
    throw new WriteError('validation_error', { field: 'basis' });
  }
  for (const proposition of propositions) {
    if (typeof proposition?.text !== 'string' || proposition.text.length === 0) {
      throw new WriteError('validation_error', { field: 'propositions.text' });
    }
  }
  const verifiedLinks = linkedIds.map((id) => verifyLink(main, dream, id));

  const callId = runtime.callId;
  const businessKey = `dream:${runtime.sessionId}:${callId}`;
  const dreamId = objectId('d', businessKey).replace(/^d_/, 'd-');
  const existing = dream.prepare('SELECT * FROM dreams WHERE idempotency_key = ?').get(businessKey);
  if (existing) {
    const expectedHash = payloadHash({ idea: item.idea, basis: item.basis, linkedIds, propositions });
    if (existing.payload_hash !== expectedHash) {
      return { ok: false, code: 'idempotency_conflict', dreamId: existing.id };
    }
    return { ok: true, replayed: true, dreamId: existing.id };
  }

  const observation = ensureModelObservation(runtime, clock, { text: item.idea, callId, slot: 0 }, deps);
  if (!observation) throw new WriteError('observation_write_failed');

  const tokens = [];
  for (const link of verifiedLinks) {
    if (link.kind === 'dream_proposition') tokens.push(link.id);
    else if (link.row?.origin) tokens.push(...parseOriginTokens(link.row.origin));
  }
  tokens.push(modelOrigin(runtime), 'model_inference');
  const origin = canonicalJson([...new Set(tokens)].sort());
  const at = clock.at().at;
  const idea = item.idea;
  const dreamRow = {
    id: dreamId,
    idempotency_key: businessKey,
    at,
    payload_hash: payloadHash({ idea, basis: item.basis, linkedIds, propositions }),
    linked_ids: canonicalJson(linkedIds),
    basis: item.basis,
    idea,
    origin,
    author_runtime: canonicalJson({ role: runtime.role, sessionId: runtime.sessionId, callId }),
    state_snapshot: JSON.stringify(buildStateSnapshot({ runtime, clock })),
    initial_strength: initialStrength(),
  };

  const spec = {
    objectKey: `dream:${dreamId}`,
    targetDb: 'dream',
    requestKey: `dream-record:${businessKey}`,
    payloadHash: dreamRow.payload_hash,
    immutablePayload: canonicalJson({ idea, basis: item.basis, linkedIds, propositions }),
    targetIds: [dreamId],
    hooks: deps.commitHooks ?? {},
  };
  const writeTxn = () =>
    withImmediate(dream, () => {
      if (dream.prepare('SELECT 1 AS ok FROM dreams WHERE id = ?').get(dreamId)) return;
      dream
        .prepare(
          `INSERT INTO dreams (id, idempotency_key, at, payload_hash, linked_ids, basis, idea, origin, author_runtime, state_snapshot, initial_strength)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          dreamRow.id, dreamRow.idempotency_key, dreamRow.at, dreamRow.payload_hash,
          dreamRow.linked_ids, dreamRow.basis, dreamRow.idea, dreamRow.origin,
          dreamRow.author_runtime, dreamRow.state_snapshot, dreamRow.initial_strength,
        );
      propositions.forEach((proposition, index) => {
        const ordinal = index + 1;
        const propositionId = `${dreamId}#p${ordinal}`;
        const text = proposition.text;
        const textHash = payloadHash({ text });
        dream
          .prepare(
            `INSERT INTO propositions (id, dream_id, ordinal, text, text_hash, at, idempotency_key, payload_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            propositionId, dreamId, ordinal, text, textHash, at,
            `${businessKey}:p${ordinal}`, payloadHash({ dreamId, ordinal, textHash }),
          );
        dream
          .prepare(
            `INSERT INTO candidates (id, dream_id, proposition_id, text, basis, origin, status, at, idempotency_key, payload_hash, state_snapshot, initial_strength)
             VALUES (?, ?, ?, ?, ?, ?, 'inferred', ?, ?, ?, ?, ?)`,
          )
          .run(
            `${propositionId}:inferred`, dreamId, propositionId, text, item.basis,
            canonicalJson([...new Set([...tokens, propositionId])].sort()), at,
            `${businessKey}:p${ordinal}:inferred`,
            payloadHash({ propositionId, textHash, basis: item.basis }),
            JSON.stringify(buildStateSnapshot({ runtime, clock })), initialStrength(),
          );
      });
      appendDreamRelation(dream, clock, {
        type: 'dream-record',
        payload: { dreamId, linkedIds, propositionIds: propositions.map((_, i) => `${dreamId}#p${i + 1}`), ideaHash: payloadHash({ idea }) },
        businessKey,
        at,
      });
    });

  const readExact = () => {
    const stored = dream.prepare('SELECT * FROM dreams WHERE id = ?').get(dreamId);
    if (!stored) return { status: 'missing', reason: 'dream_absent' };
    const props = dream.prepare('SELECT id, text_hash FROM propositions WHERE dream_id = ? ORDER BY ordinal').all(dreamId);
    const cands = dream.prepare('SELECT id FROM candidates WHERE dream_id = ?').all(dreamId);
    if (props.length !== propositions.length || cands.length !== propositions.length) {
      return { status: 'unknown', reason: 'dream_set_incomplete' };
    }
    return { status: 'found', row: stored };
  };

  const receipt = commitControlled({ control: deps.control, clock, spec, writeTxn, readExact });
  if (receipt.status !== 'found') {
    return { ok: false, code: receipt.readback?.reason ?? 'readback_not_found', dreamId };
  }
  const propositionIds = propositions.map((_, index) => `${dreamId}#p${index + 1}`);
  return { ok: true, dreamId, propositionIds, observationId: observation.id };
}

export { appendDreamRelation, dreamNextSeq, ensureModelObservation, verifyLink };
