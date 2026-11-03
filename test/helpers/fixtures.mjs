import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveConfig } from '../../src/config.mjs';
import { openAll, closeAll } from '../../src/storage/open.mjs';
import { migrateAll } from '../../src/storage/migrate.mjs';
import { appendRelation, seedInitialRegistry } from '../../src/storage/repositories.mjs';
import { createClock } from '../../src/clock.mjs';
import { buildStateSnapshot, initialStrength } from '../../src/contracts.mjs';
import { formatSourceSpan, keys, objectId, payloadHash } from '../../src/identity.mjs';
import { TEST_IDENTITY, TEST_SESSION, fakeRuntime } from './runtime.mjs';

export function fixedClock(iso = '2026-11-03T00:00:00.000Z') {
  return createClock({ now: () => new Date(iso) });
}

/** Temp workspace with migrated main/control/dream databases and seeded registry. */
export function createTestContext(options = {}) {
  const clock = options.clock ?? createClock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memsys-m1-'));
  const config = resolveConfig({ dataDir: dir, mode: options.mode ?? 'work' });
  const handles = openAll(config);
  migrateAll(handles, { clock });
  handles.main.exec('BEGIN IMMEDIATE');
  try {
    seedInitialRegistry(handles.main, clock);
    handles.main.exec('COMMIT');
  } catch (err) {
    try {
      handles.main.exec('ROLLBACK');
    } catch {
      // keep original
    }
    throw err;
  }
  return {
    dir,
    config,
    handles,
    main: handles.main,
    control: handles.control,
    dream: handles.dream,
    clock,
    cleanup() {
      closeAll(handles);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeObservation(ctx, overrides = {}) {
  const runtime = overrides.runtime ?? fakeRuntime();
  const text = overrides.text ?? '不吃葱。';
  const messageSeq = overrides.messageSeq ?? 1;
  const businessKey =
    overrides.businessKey ??
    keys.observationConversation(runtime.identity, runtime.sessionId, messageSeq);
  const at = ctx.clock.at().at;
  const source = overrides.source ?? 'conversation';
  const authorKind = overrides.authorKind ?? 'owner';
  const origin = overrides.origin ?? 'master@2026-11-03';
  return {
    id: objectId('obs', businessKey),
    idempotency_key: businessKey,
    at,
    payload_hash: payloadHash({ text, source, authorKind, origin }),
    text,
    source,
    author_kind: authorKind,
    runtime_refs: JSON.stringify({ sessionId: runtime.sessionId, roundId: runtime.roundId }),
    origin,
    lossy: 0,
    state_snapshot: JSON.stringify(
      buildStateSnapshot({ runtime, clock: ctx.clock, energy: overrides.energy }),
    ),
    initial_strength: initialStrength({ energy: overrides.energy }),
    recorded_at: at,
  };
}

export function makeCandidate(ctx, observation, overrides = {}) {
  const sourceUnit = overrides.sourceUnit ?? formatSourceSpan(0, Buffer.byteLength(observation.text, 'utf8'));
  const businessKey = overrides.businessKey ?? keys.capture(observation.id, sourceUnit);
  const at = ctx.clock.at().at;
  const text = overrides.text ?? observation.text;
  const why = overrides.why ?? '输入原话留存，待提炼';
  const type = overrides.type ?? 'episode';
  const scene = overrides.scene ?? 'work';
  const scope = overrides.scope ?? 'work-only';
  const semanticStatus = overrides.semanticStatus ?? 'quoted';
  const recordKind = overrides.recordKind ?? 'utterance';
  const origin = overrides.origin ?? observation.origin;
  const stateSnapshot = JSON.stringify(
    buildStateSnapshot({ runtime: fakeRuntime({ sessionId: TEST_SESSION }), clock: ctx.clock }),
  );
  return {
    id: objectId('cand', businessKey),
    idempotency_key: businessKey,
    at,
    payload_hash: payloadHash({ text, why, type, scene, scope, sourceUnit }),
    observation_id: observation.id,
    source_unit: sourceUnit,
    source_path: overrides.sourcePath ?? 'capture',
    text,
    detail: overrides.detail ?? null,
    why,
    type,
    scene,
    scope,
    tags: JSON.stringify(overrides.tags ?? []),
    topic_key: overrides.topicKey ?? null,
    topic_components: overrides.topicComponents ? JSON.stringify(overrides.topicComponents) : null,
    registry_revision: overrides.registryRevision ?? null,
    structured_value: overrides.structuredValue ? JSON.stringify(overrides.structuredValue) : null,
    semantic_status: semanticStatus,
    record_kind: recordKind,
    origin,
    confidence: overrides.confidence ?? 0.5,
    lossy: 0,
    start_at: overrides.startAt ?? null,
    end_at: overrides.endAt ?? null,
    prec_start: 'unknown',
    prec_end: 'unknown',
    time_state: overrides.timeState ?? 'point',
    due_at: overrides.dueAt ?? null,
    weight: overrides.weight ?? 5,
    pointer_status: overrides.pointerStatus ?? 'unknown',
    pointer_location: overrides.pointerLocation ?? null,
    pointer_search_hint: null,
    judgment_id: null,
    key_status: overrides.topicKey ? 'resolved' : 'unresolved',
    binding_status: 'proposed',
    binding_basis: JSON.stringify({ ruleRevision: 'topic-v1', source: 'fixture' }),
    origin_mode: 'self',
    creator_session_id: TEST_SESSION,
    owner_touched: 0,
    reason: overrides.reason ?? null,
    resolved_from: null,
    state_snapshot: stateSnapshot,
    initial_strength: initialStrength(),
    status: overrides.status ?? 'pending',
    promoted_at: null,
    rejected_reason: null,
    review_policy: overrides.reviewPolicy ?? 'candidate-v1',
    policy_revision: '1',
    deadline_at: null,
    created_input_seq: overrides.createdInputSeq ?? 1,
    recorded_at: at,
  };
}

export function makeMemory(ctx, candidate, overrides = {}) {
  const businessKey = overrides.businessKey ?? keys.promote(candidate.id);
  const at = ctx.clock.at().at;
  return {
    id: objectId('mem', businessKey),
    idempotency_key: businessKey,
    at,
    payload_hash: payloadHash({ text: candidate.text, why: candidate.why, candidate: candidate.id }),
    text: candidate.text,
    detail: candidate.detail,
    why: candidate.why,
    type: candidate.type,
    scene: candidate.scene,
    scope: candidate.scope,
    tags: candidate.tags,
    topic_key: candidate.topic_key,
    topic_components: candidate.topic_components,
    registry_revision: candidate.registry_revision,
    structured_value: candidate.structured_value,
    semantic_status: candidate.semantic_status,
    record_kind: candidate.record_kind,
    origin: candidate.origin,
    credibility: overrides.credibility ?? 'unverified',
    lossy: candidate.lossy,
    judgment_id: null,
    key_status: candidate.key_status ?? 'unresolved',
    binding_status: candidate.binding_status ?? 'proposed',
    binding_basis: candidate.binding_basis ?? JSON.stringify({ ruleRevision: 'topic-v1', source: 'fixture' }),
    origin_mode: candidate.origin_mode ?? 'self',
    weight: overrides.weight ?? candidate.weight,
    state_snapshot: candidate.state_snapshot,
    initial_strength: candidate.initial_strength,
    recorded_at: at,
    promoted_from: candidate.id,
    due_state: overrides.dueState ?? 'none',
    due_done_at: null,
    last_touched_at: at,
  };
}

export const TEST_OWNER = TEST_IDENTITY;

/** Clock whose reading can be advanced explicitly (deadline/aging tests). */
export function mutableClock(iso = '2026-11-03T00:00:00.000Z') {
  let current = Date.parse(iso);
  const inner = createClock({ now: () => new Date(current) });
  return {
    clock: inner,
    advance(ms) {
      current += ms;
    },
    set(isoText) {
      current = Date.parse(isoText);
    },
    currentMs() {
      return current;
    },
  };
}

/**
 * Extend the fixed registry with a formally registered entity (test-only seed).
 * Production code has no model-facing registration entry in batch 1.
 */
export function registerEntity(ctx, { id, canonical, alias = null }) {
  const registry = ctx.main.prepare("SELECT value, revision FROM config WHERE key = 'registry'").get();
  const value = JSON.parse(registry.value);
  const nextRevision = String(Number(registry.revision) + 1);
  value.entity_registry.push({ id, kind: 'ingredient', canonical });
  if (alias) value.alias_registry.push({ alias, entityId: id, namespace: 'default' });
  value.revision = nextRevision;
  ctx.main.exec('BEGIN IMMEDIATE');
  try {
    ctx.main
      .prepare("UPDATE config SET value = ?, revision = ? WHERE key = 'registry'")
      .run(JSON.stringify(value), Number(nextRevision));
    appendRelation(ctx.main, {
      type: 'config-change',
      payload: { config: 'registry', newRevision: Number(nextRevision), change: 'test-fixture-register' },
      businessKey: `config-change:registry:${nextRevision}`,
      at: ctx.clock.at().at,
    });
    ctx.main.exec('COMMIT');
  } catch (err) {
    try {
      ctx.main.exec('ROLLBACK');
    } catch {
      // keep original
    }
    throw err;
  }
  return value;
}
