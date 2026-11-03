import { formatSourceSpan, keys, objectId } from '../identity.mjs';
import { commitControlled } from '../control/commit.mjs';
import { readExactMemorySet } from '../control/readback.mjs';
import { withImmediate, withSavepoint } from '../storage/open.mjs';
import {
  appendRelation,
  getCandidateByKey,
  getMemoryByBusinessKey,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertReviewQueue,
  listEvidence,
} from '../storage/repositories.mjs';
import { WriteError, assertDailyRuntime } from './authority.mjs';
import {
  expectedWindowScope,
  inputSeqOfMain,
  makeCandidateRow,
} from './candidate.mjs';
import { promoteInTransaction } from './promote.mjs';
import { registryOf, unresolvedTopicKey } from './topic.mjs';

export const CAPTURE_COMMAND = /^记住：([\s\S]+)$/;
const COMMAND_PREFIX_BYTES = Buffer.byteLength('记住：', 'utf8');

/** Exact whole-message command only; body keeps its literal bytes. */
export function matchCaptureCommand(text) {
  if (typeof text !== 'string') return { matched: false };
  const match = CAPTURE_COMMAND.exec(text);
  if (!match) return { matched: false };
  const body = match[1];
  if (body.trim().length === 0) return { matched: false };
  return { matched: true, body };
}

function reviewQueueRow({ kind, objectId: target, policy, deadlineAt, inputSeq, at, status = 'open' }) {
  return {
    id: objectId('rq', `${kind}:${target}:${inputSeq}`),
    object_kind: kind,
    object_id: target,
    review_policy: policy,
    policy_revision: '1',
    deadline_at: deadlineAt,
    created_input_seq: inputSeq,
    status,
    close_reason: null,
    created_at: at,
    updated_at: at,
  };
}

/**
 * Path A capture: every trusted user message yields one capture candidate.
 * The fixed `记住：<text>` command additionally creates a quoted memory and
 * shelves the capture candidate in the SAME transaction.
 */
export function captureObservation(runtime, observationId, deps) {
  assertDailyRuntime(runtime);
  const { main, control, clock } = deps;
  const observation = getObservation(main, observationId);
  if (!observation) throw new WriteError('observation_missing', { observationId });

  const sourceUnit = formatSourceSpan(0, Buffer.byteLength(observation.text, 'utf8'));
  const captureKey = keys.capture(observationId, sourceUnit);
  const command = matchCaptureCommand(observation.text);
  const quoteKey = keys.quote(observationId);

  const existingCapture = getCandidateByKey(main, captureKey);
  if (existingCapture) {
    const memory = command.matched ? getMemoryByBusinessKey(main, keys.promote(objectId('cand', quoteKey))) : null;
    return { capture: existingCapture, memory, replayed: true };
  }

  const at = clock.at().at;
  const inputSeq = inputSeqOfMain(main, runtime.identity);
  const deadlineAt = new Date(Date.parse(at) + 24 * 60 * 60 * 1000).toISOString();
  const registry = registryOf(main);
  const topic = {
    topicKey: unresolvedTopicKey(observationId, sourceUnit),
    keyStatus: 'unresolved',
    bindingStatus: 'quoted',
    registryRevision: registry?.revision ?? null,
    components: null,
  };

  const captureCandidate = makeCandidateRow({
    runtime,
    clock,
    observation,
    businessKey: captureKey,
    sourcePath: 'capture',
    sourceUnit,
    text: observation.text,
    why: '输入原话留存，待提炼',
    type: 'episode',
    scene: runtime.mode ?? 'work',
    scope: expectedWindowScope(runtime),
    semanticStatus: 'quoted',
    recordKind: 'utterance',
    topic,
    status: command.matched ? 'shelved' : 'pending',
    reason: command.matched ? 'explicit_capture_promoted' : null,
    reviewPolicy: 'capture-v1',
    deadlineAt,
    createdInputSeq: inputSeq,
    origin: observation.origin,
  });

  const quoteCandidate = command.matched
    ? makeCandidateRow({
        runtime,
        clock,
        observation,
        businessKey: quoteKey,
        sourcePath: 'capture',
        sourceUnit: 'command_body',
        text: command.body,
        why: '主人显式要求保留原话',
        type: 'episode',
        scene: runtime.mode ?? 'work',
        scope: expectedWindowScope(runtime),
        semanticStatus: 'quoted',
        recordKind: 'utterance',
        topic: {
          topicKey: unresolvedTopicKey(observationId, 'command_body'),
          keyStatus: 'unresolved',
          bindingStatus: 'quoted',
          registryRevision: registry?.revision ?? null,
          components: null,
        },
        status: 'pending',
        reviewPolicy: 'capture-v1',
        deadlineAt: null,
        createdInputSeq: inputSeq,
        origin: observation.origin,
      })
    : null;

  const captureEvidence = {
    id: objectId('ev', `candidate:${captureCandidate.id}:${observation.id}:${sourceUnit}`),
    memory_id: null,
    candidate_id: captureCandidate.id,
    observation_id: observation.id,
    source_memory_id: null,
    role: 'basis',
    source_span: sourceUnit,
    at,
  };
  const bodySpan = command.matched
    ? formatSourceSpan(
        COMMAND_PREFIX_BYTES,
        COMMAND_PREFIX_BYTES + Buffer.byteLength(command.body, 'utf8'),
      )
    : null;
  const quoteEvidence = quoteCandidate
    ? {
        id: objectId('ev', `candidate:${quoteCandidate.id}:${observation.id}:command_body`),
        memory_id: null,
        candidate_id: quoteCandidate.id,
        observation_id: observation.id,
        source_memory_id: null,
        role: 'basis',
        source_span: bodySpan,
        at,
      }
    : null;

  const spec = {
    objectKey: `main:${captureCandidate.id}`,
    targetDb: 'main',
    requestKey: `capture:${captureKey}`,
    payloadHash: captureCandidate.payload_hash,
    immutablePayload: JSON.stringify({
      capture: captureCandidate.id,
      quote: quoteCandidate?.id ?? null,
    }),
    targetIds: [captureCandidate.id, observation.id],
    expected: {
      kind: 'candidate',
      payloadHash: captureCandidate.payload_hash,
      events: quoteCandidate ? [{ type: 'shelve', key: captureCandidate.id }] : [],
    },
    actual: () => ({
      row: main.prepare('SELECT * FROM candidates WHERE id = ?').get(captureCandidate.id),
      events: main
        .prepare("SELECT type, json_extract(payload, '$.targetId') AS targetId FROM relations WHERE type = 'shelve' AND json_extract(payload, '$.targetId') = ?")
        .all(captureCandidate.id)
        .map((row) => ({ type: row.type, key: row.targetId })),
    }),
    hooks: deps.commitHooks ?? {},
  };

  const writeTxn = () =>
    withImmediate(main, () => {
      insertCandidate(main, captureCandidate);
      insertEvidence(main, captureEvidence);
      if (quoteCandidate) {
        insertCandidate(main, quoteCandidate);
        insertEvidence(main, quoteEvidence);
        withSavepoint(main, `promote_${quoteCandidate.id.slice(0, 12)}`, () =>
          promoteInTransaction(main, {
            candidate: quoteCandidate,
            runtime,
            clock,
            hooks: deps.faultInjector?.promoteHooks ?? {},
          }),
        );
        appendRelation(main, {
          type: 'shelve',
          payload: {
            targetId: captureCandidate.id,
            reason: 'explicit_capture_promoted',
            receiptId: null,
          },
          businessKey: `${captureCandidate.id}:explicit_capture_promoted`,
          at,
        });
      } else {
        insertReviewQueue(
          main,
          reviewQueueRow({
            kind: 'capture',
            objectId: captureCandidate.id,
            policy: 'capture-v1',
            deadlineAt,
            inputSeq,
            at,
          }),
        );
      }
    });

  const readExact = () => {
    const storedCapture = main
      .prepare('SELECT * FROM candidates WHERE id = ?')
      .get(captureCandidate.id);
    if (!storedCapture) return { status: 'missing', reason: 'capture_absent' };
    if (!command.matched) {
      const expectedStatus = 'pending';
      return storedCapture.status === expectedStatus
        ? { status: 'found', row: storedCapture }
        : { status: 'unknown', reason: 'capture_status_mismatch', actual: storedCapture.status };
    }
    const storedQuote = main.prepare('SELECT * FROM candidates WHERE id = ?').get(quoteCandidate.id);
    if (!storedQuote) return { status: 'unknown', reason: 'quote_missing' };
    if (storedQuote.status !== 'promoted') {
      return { status: 'unknown', reason: 'quote_not_promoted', actual: storedQuote.status };
    }
    if (storedCapture.status !== 'shelved') {
      return { status: 'unknown', reason: 'capture_not_shelved', actual: storedCapture.status };
    }
    const memory = getMemoryByBusinessKey(main, keys.promote(quoteCandidate.id));
    if (!memory) return { status: 'missing', reason: 'quoted_memory_absent' };
    const evidenceIds = listEvidence(main, 'candidate', quoteCandidate.id).map((row) =>
      objectId('ev', `${memory.id}:${row.id}`),
    );
    return readExactMemorySet(main, memory, evidenceIds);
  };

  const receipt = commitControlled({ control, clock, spec, writeTxn, readExact });
  const storedCapture = main.prepare('SELECT * FROM candidates WHERE id = ?').get(captureCandidate.id) ?? null;
  const memory = quoteCandidate
    ? getMemoryByBusinessKey(main, keys.promote(quoteCandidate.id))
    : null;
  return {
    capture: storedCapture,
    memory,
    replayed: false,
    receipt,
    status: receipt.status,
  };
}
