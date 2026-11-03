import { objectId, payloadHash } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  insertCandidate,
  insertEvidence,
  insertObservation,
  getObservation,
} from '../storage/repositories.mjs';
import { searchMemories } from '../read/search.mjs';
import { compileRound } from '../context/compile.mjs';
import { conservativeTokens } from '../context/budget.mjs';
import { recordSelfNotes } from '../write/self-note.mjs';
import { WriteError } from '../write/authority.mjs';

const SERVICE_ROLE = 'model';

function assertCaller(caller = {}) {
  if (caller.role === 'owner' || caller.role === 'master' || caller.isOwner === true) {
    throw new WriteError('validation_error', { field: 'role', reason: 'service_caller_not_owner' });
  }
}

function candidateIdFor(source, externalId) {
  return objectId('cand', `svc:${source}:${externalId}`);
}

export function createMemSysService({ main, control, clock }) {
  const deps = { main, control, clock };
  return {
    version: 1,

    list({ limit = 20, offset = 0, kind = 'memory' } = {}) {
      const table = kind === 'candidate' || kind === 'candidates' ? 'candidates' : 'memories';
      const take = Math.max(1, Math.min(200, Number(limit) || 20));
      const skip = Math.max(0, Number(offset) || 0);
      const total = Number(main.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
      const rows = main
        .prepare(`SELECT id, text, recorded_at AS created_at FROM ${table} ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(take, skip);
      return {
        kind: table === 'candidates' ? 'candidate' : 'memory',
        total,
        limit: take,
        offset: skip,
        items: rows.map((row) => ({
          id: row.id,
          text: Array.from(String(row.text ?? '')).slice(0, 120).join(''),
          created_at: row.created_at,
        })),
      };
    },

    sample({ n = 5 } = {}) {
      const take = Math.max(1, Math.min(50, Number(n) || 5));
      const rows = main
        .prepare('SELECT id, text, recorded_at AS created_at FROM memories ORDER BY RANDOM() LIMIT ?')
        .all(take);
      return {
        n: take,
        items: rows.map((row) => ({
          id: row.id,
          text: Array.from(String(row.text ?? '')).slice(0, 120).join(''),
          created_at: row.created_at,
        })),
      };
    },

    ingest(input = {}, caller = {}) {
      assertCaller(caller);
      const source = String(input.source ?? '').trim();
      const externalId = String(input.externalId ?? '').trim();
      const text = String(input.text ?? '');
      if (!source || !externalId || !text) {
        throw new WriteError('validation_error', { field: 'source/externalId/text' });
      }
      const obsKey = `svc:${source}:${externalId}`;
      const observationId = objectId('obs', obsKey);
      const candidateId = candidateIdFor(source, externalId);
      const existing = getObservation(main, observationId);
      if (existing) {
        const candidate = main.prepare('SELECT id FROM candidates WHERE observation_id = ?').get(observationId);
        return { status: 'duplicate', candidateId: candidate?.id ?? null };
      }
      const at = input.at ?? clock.at().at;
      const origin = `source:${source}:${externalId}`;
      const sourceUnit = `bytes:0:${Buffer.byteLength(text, 'utf8')}`;
      withImmediate(main, () => {
        insertObservation(main, {
          id: observationId,
          idempotency_key: obsKey,
          at,
          payload_hash: payloadHash({ text, source, externalId }),
          text,
          source: 'file',
          author_kind: 'file',
          runtime_refs: JSON.stringify({ source, externalId, url: input.url ?? null, author: input.author ?? null }),
          origin: JSON.stringify([origin]),
          lossy: 0,
          state_snapshot: '{}',
          initial_strength: 0.5,
          recorded_at: at,
        });
        insertCandidate(main, {
          id: candidateId,
          idempotency_key: obsKey,
          at,
          payload_hash: payloadHash({ text, why: 'service ingest', type: input.kind ?? 'fact', scene: input.scene ?? 'work', sourceUnit }),
          observation_id: observationId,
          source_unit: sourceUnit,
          source_path: 'tool',
          text,
          detail: null,
          why: 'service ingest',
          type: input.kind ?? 'fact',
          scene: input.scene ?? 'work',
          scope: input.scope ?? 'work-only',
          tags: JSON.stringify(input.tags ?? []),
          topic_key: null,
          topic_components: null,
          registry_revision: null,
          structured_value: null,
          semantic_status: 'proposed',
          record_kind: 'assertion',
          origin: JSON.stringify([origin]),
          confidence: 0.5,
          lossy: 0,
          start_at: input.at ?? null,
          end_at: null,
          prec_start: 'unknown',
          prec_end: 'unknown',
          time_state: 'point',
          due_at: null,
          weight: 5,
          pointer_status: 'unknown',
          pointer_location: input.url ?? null,
          pointer_search_hint: null,
          judgment_id: null,
          key_status: 'unresolved',
          binding_status: 'proposed',
          binding_basis: JSON.stringify({ ruleRevision: 'topic-v1', source: 'service' }),
          origin_mode: 'inherited',
          creator_session_id: caller.sessionId ?? 'service',
          owner_touched: 0,
          reason: null,
          resolved_from: null,
          state_snapshot: '{}',
          initial_strength: 0.5,
          status: 'pending',
          promoted_at: null,
          rejected_reason: null,
          review_policy: 'candidate-v1',
          policy_revision: '1',
          deadline_at: null,
          created_input_seq: 1,
          recorded_at: at,
        });
        insertEvidence(main, {
          id: objectId('ev', `svc:${candidateId}`),
          memory_id: null,
          candidate_id: candidateId,
          observation_id: observationId,
          source_memory_id: null,
          role: 'basis',
          source_span: sourceUnit,
          at,
        });
      });
      return { status: 'accepted', candidateId, observationId };
    },

    search(query = {}) {
      return searchMemories({
        main, clock,
        keywords: query.q ?? null,
        scene: query.scene ?? null,
        maxChars: query.limit ? Math.max(1000, Math.min(16000, Number(query.limit) * 200)) : 8000,
      });
    },

    directory(query = {}) {
      const budget = Number.isFinite(query.budget) ? query.budget : 4000;
      const result = compileRound({
        main, control, clock,
        sessionId: 'service-directory',
        roundId: 'service-directory',
        mode: query.scene === 'life' ? 'life' : 'work',
        tokenizer: conservativeTokens,
        H: budget,
      });
      return result?.section?.text ?? '';
    },

    recordSelf(input = {}, caller = {}) {
      assertCaller(caller);
      const text = String(input.text ?? '');
      if (!text) throw new WriteError('validation_error', { field: 'text' });
      const runtime = {
        role: SERVICE_ROLE,
        identity: caller.agentId ?? caller.sessionId ?? 'service',
        agentId: caller.agentId ?? null,
        sessionId: caller.sessionId ?? 'service',
        callId: caller.callId ?? 'service',
      };
      return recordSelfNotes(runtime, {
        items: [{ text, tags: input.tags ?? [], kind: 'self_note' }],
      }, deps);
    },
  };
}

export function provideMemSysService(ctx, service) {
  if (typeof ctx?.provide !== 'function') throw new WriteError('service_unavailable', { reason: 'provide_missing' });
  return ctx.provide('memsys', service, (value) => Boolean(value && value.version === 1));
}
