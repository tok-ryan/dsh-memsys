import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { withImmediate } from '../storage/open.mjs';
import { appendRelation, getCandidate, getMemory, getObservation, insertObservation } from '../storage/repositories.mjs';
import { WriteError, assertDailyRuntime } from '../write/authority.mjs';
import { promoteCandidate, recordCandidates, rejectCandidate } from '../write/candidate.mjs';
import { proposeOwnerAction } from '../write/review.mjs';
import { recordSelfNotes } from '../write/self-note.mjs';
import {
  recordJudgments,
  recordOutcomeChange,
  recordSpeculations,
  recordVerdict,
} from '../write/judgment.mjs';
import { createNeedsReview } from '../write/judgment-review.mjs';
import { updateProject } from '../write/project.mjs';
import {
  RECORD_KINDS_BATCH1,
  RECORD_KINDS_UNSUPPORTED,
  validateRecordRequest,
} from './schemas.mjs';

function errorItem(code, detail = {}) {
  return { error: code, ...detail };
}

function recordFeedback(runtime, request, deps) {
  const { main, clock } = deps;
  const at = clock.at().at;
  const items = (request.items ?? []).map((item) => {
    const used = item.usedMemoryIds ?? item.used_memory_ids ?? [];
    if (!Array.isArray(used)) return errorItem('validation_error', { field: 'used_memory_ids' });
    const roundId = item.roundId ?? runtime.roundId ?? null;
    const payload = { roundId, usedMemoryIds: used };
    return withImmediate(main, () => {
      appendRelation(main, {
        type: 'injection-feedback',
        payload,
        businessKey: `${roundId}:${canonicalJson(used)}`,
        at,
      });
      return { status: 'recorded', roundId, usedMemoryIds: used };
    });
  });
  return { items };
}

function timelineChange(runtime, request, deps) {
  const { main, clock } = deps;
  const at = clock.at().at;
  return {
    items: (request.items ?? []).map((item) => {
      try {
        if (item.to !== 'ended_unknown') {
          throw new WriteError('validation_error', { field: 'to', rule: 'batch1_only_ends_ongoing' });
        }
        return withImmediate(main, () => {
          const timeline = main
            .prepare('SELECT * FROM timeline WHERE memory_id = ?')
            .get(item.targetId);
          if (!timeline) throw new WriteError('timeline_missing', { targetId: item.targetId });
          if (item.from && item.from !== timeline.time_state) {
            throw new WriteError('stale_timeline', { current: timeline.time_state });
          }
          main
            .prepare('UPDATE timeline SET time_state = ?, revision = revision + 1 WHERE memory_id = ?')
            .run(item.to, item.targetId);
          appendRelation(main, {
            type: 'timeline-change',
            payload: {
              memoryId: item.targetId,
              baseRevision: timeline.revision,
              from: timeline.time_state,
              to: item.to,
              authority: runtime.role,
            },
            businessKey: `${item.targetId}:${timeline.revision}:${item.to}`,
            at,
          });
          return { status: 'found', id: item.targetId };
        });
      } catch (err) {
        return errorItem(err.code ?? 'error', { message: err.message });
      }
    }),
  };
}

function pointerChange(runtime, request, deps) {
  const { main, clock } = deps;
  const at = clock.at().at;
  return {
    items: (request.items ?? []).map((item) => {
      try {
        return withImmediate(main, () => {
          const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(item.targetId);
          if (!pointer) throw new WriteError('pointer_missing', { targetId: item.targetId });
          if (item.from && item.from !== pointer.status) {
            throw new WriteError('stale_pointer', { current: pointer.status });
          }
          if (item.to === 'exact' && !item.location) {
            throw new WriteError('validation_error', { field: 'location' });
          }
          main
            .prepare(
              'UPDATE pointers SET status = ?, location = ?, revision = revision + 1 WHERE memory_id = ?',
            )
            .run(item.to, item.location ?? null, item.targetId);
          appendRelation(main, {
            type: 'pointer-change',
            payload: {
              memoryId: item.targetId,
              baseRevision: pointer.revision,
              from: pointer.status,
              to: item.to,
              authority: runtime.role,
            },
            businessKey: `${item.targetId}:${pointer.revision}:${item.to}`,
            at,
          });
          return { status: 'found', id: item.targetId };
        });
      } catch (err) {
        return errorItem(err.code ?? 'error', { message: err.message });
      }
    }),
  };
}

/**
 * memsys_record handler. Business handlers are offline-testable; host tool
 * registration is batch M5 and is not assumed here.
 */
function needsReview(runtime, request, deps) {
  const { main, clock } = deps;
  return {
    items: (request.items ?? []).map((item) => {
      const judgmentId = item.judgmentId;
      const judgment = main.prepare('SELECT 1 AS ok FROM judgments WHERE id = ?').get(judgmentId);
      if (!judgment) return { error: 'validation_error', field: 'judgmentId' };
      const at = clock.at().at;
      const inputSeqRow = main
        .prepare('SELECT value FROM state WHERE key = ?')
        .get(`input-seq:${runtime.identity}`);
      const inputSeq = inputSeqRow ? Number(JSON.parse(inputSeqRow.value).value ?? 0) : 0;
      const created = withImmediate(main, () =>
        createNeedsReview(main, {
          judgmentId,
          trigger: 'explicit',
          sourceVersion: `${judgmentId}:${runtime.callId}:${item.slot ?? 0}`,
          why: item.why ?? 'model requested review',
          at,
          inputSeq,
        }),
      );
      return { status: 'found', reviewId: created.reviewId, replayed: created.replayed };
    }),
  };
}

function projectUpdate(runtime, request, deps) {
  if (runtime.mode !== 'work') {
    return { status: 'error', code: 'unsupported_in_batch', rule: 'life_window_requires_owner_receipt' };
  }
  return {
    items: (request.items ?? []).map((item) => {
      const result = updateProject(deps, {
        projectId: item.projectId,
        baseRevision: item.baseRevision ?? null,
        patch: item.snapshot ?? item.patch ?? {},
        evidenceRefs: item.evidence_refs ?? item.evidenceRefs ?? [],
        requestId: runtime.requestId ?? runtime.callId,
        semanticStatus: 'proposed',
        runtime,
      });
      return result.ok
        ? { status: 'found', revision: result.revision, inherited: result.inherited, changed: result.changed }
        : { error: result.code, detail: result };
    }),
  };
}

export function createRecordHandler(deps) {
  return {
    record(runtime, request = {}) {
      try {
        const pendingKind = request?.kind;
        if (pendingKind === 'self_note') {
          // Author binding (daily or dream) is enforced inside recordSelfNotes.
        } else {
          assertDailyRuntime(runtime);
        }
        const validation = validateRecordRequest(request);
        if (!validation.ok) {
          return { status: 'error', code: 'validation_error', errors: validation.errors, items: [] };
        }
        const kind = request.kind;
        if (RECORD_KINDS_UNSUPPORTED.includes(kind)) {
          return {
            status: 'error',
            code: 'unsupported_in_batch',
            items: request.items.map((item, index) => ({
              index,
              error: 'unsupported_in_batch',
              kind,
            })),
          };
        }
        switch (kind) {
          case 'self_note':
            return recordSelfNotes(runtime, request, deps);
          case 'judgment':
            return recordJudgments(runtime, request, deps);
          case 'speculation':
            return recordSpeculations(runtime, request, deps);
          case 'outcome_change':
            return recordOutcomeChange(runtime, request, deps);
          case 'verdict':
            return recordVerdict(runtime, request, deps);
          case 'needs_review':
            return needsReview(runtime, request, deps);
          case 'project_update':
            return projectUpdate(runtime, request, deps);
          case 'candidate': {
            const items = (request.items ?? []).map((item, index) => {
              if (item.observationId) return item;
              const text = typeof item.text === 'string' ? item.text : '';
              const obsKey = `obs:tool:${runtime.sessionId}:${runtime.callId}:${index}`;
              const observationId = objectId('obs', obsKey);
              const at = deps.clock.at().at;
              withImmediate(deps.main, () => {
                if (getObservation(deps.main, observationId)) return;
                insertObservation(deps.main, {
                  id: observationId,
                  idempotency_key: obsKey,
                  at,
                  payload_hash: payloadHash({ text, source: 'model', authorKind: 'model' }),
                  text,
                  source: 'model',
                  author_kind: 'model',
                  runtime_refs: JSON.stringify({ sessionId: runtime.sessionId, callId: runtime.callId, agentId: runtime.agentId ?? null }),
                  origin: canonicalJson([`model:${runtime.agentId ?? ''}:${runtime.sessionId}:${runtime.callId}`]),
                  lossy: 0,
                  state_snapshot: '{}',
                  initial_strength: 0.5,
                  recorded_at: at,
                });
              });
              return {
                ...item,
                observationId,
                why: item.why ?? 'tool_record',
                type: item.type ?? 'fact',
                scene: item.scene ?? 'work',
                scope: item.scope ?? 'work-only',
                evidenceRefs: [{ observationId, sourceSpan: `bytes:0:${Buffer.byteLength(text, 'utf8')}` }],
              };
            });
            return recordCandidates(runtime, { ...request, items }, deps);
          }
          case 'promote_candidate':
            return {
              items: request.items.map((item) =>
                promoteCandidate(runtime, item.candidateId, item.baseRevision, deps),
              ),
            };
          case 'reject_candidate':
            return {
              items: request.items.map((item) =>
                rejectCandidate(runtime, item.candidateId, item.reason, deps),
              ),
            };
          case 'propose_owner_action':
            return {
              items: request.items.map((item) => proposeOwnerAction(runtime, item, deps)),
            };
          case 'feedback':
            return recordFeedback(runtime, request, deps);
          case 'timeline_change':
            return timelineChange(runtime, request, deps);
          case 'pointer_change':
            return pointerChange(runtime, request, deps);
          default:
            return {
              status: 'error',
              code: 'unsupported_in_batch',
              items: request.items.map((item, index) => ({ index, error: 'unsupported_in_batch' })),
            };
        }
      } catch (err) {
        return {
          status: 'error',
          code: err.code ?? 'write_failed',
          message: err.message,
          items: [],
        };
      }
    },
  };
}

void getCandidate;
void getMemory;
void RECORD_KINDS_BATCH1;
