import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { canonicalJson, objectId, payloadHash } from '../identity.mjs';
import { buildStateSnapshot, initialStrength } from '../contracts.mjs';
import { commitControlled } from '../control/commit.mjs';
import { withImmediate } from '../storage/open.mjs';
import {
  appendRelation,
  getCandidate,
  getMemory,
  getObservation,
  insertCandidate,
  insertEvidence,
  insertObservation,
} from '../storage/repositories.mjs';
import { promoteInTransaction } from '../write/promote.mjs';
import { resolveTopic } from '../write/topic.mjs';
import { WriteError } from '../write/authority.mjs';

export const SOURCE_SYSTEM = 'whale-soul';
export const MAPPING_POLICY = 'legacy-v1';
export const MIGRATED_ORIGIN = 'migrated:whale-soul';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readStrictUtf8(file) {
  const bytes = fs.readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WriteError('invalid_utf8', { file });
  }
  return { bytes, text };
}

function looksLikeNpmRegistry(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value['dist-tags'] || value._id || value.versions || value['_rev']),
  );
}

/** Discover a read-only source directory and reject non-memory formats. */
export function discoverSource(sourceDir) {
  const root = path.resolve(sourceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new WriteError('source_missing', { sourceDir: root });
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const real = fs.realpathSync(full);
      if (entry.isSymbolicLink()) throw new WriteError('source_symlink_forbidden', { file: full });
      if (!real.startsWith(fs.realpathSync(root))) throw new WriteError('source_escape', { file: full });
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  const inventory = files.sort().map((file) => {
    const { bytes } = readStrictUtf8(file);
    return { path: path.relative(root, file).replace(/\\/g, '/'), sha256: sha256(bytes), bytes: bytes.length };
  });
  return { root, files: inventory };
}

export function parseLegacySource(sourceDir) {
  const discovery = discoverSource(sourceDir);
  const legacyFile = discovery.files.find((file) => file.path.endsWith('legacy.json'));
  if (!legacyFile) throw new WriteError('unsupported_legacy_format', { reason: 'no_legacy_json' });
  const { text } = readStrictUtf8(path.join(discovery.root, legacyFile.path));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WriteError('unsupported_legacy_format', { reason: 'invalid_json' });
  }
  if (looksLikeNpmRegistry(parsed)) {
    throw new WriteError('unsupported_legacy_format', { reason: 'npm_registry_metadata' });
  }
  if (!Array.isArray(parsed.records)) {
    throw new WriteError('unsupported_legacy_format', { reason: 'records_missing' });
  }
  return { discovery, parsed, legacyPath: legacyFile.path };
}

/**
 * Frozen, deterministic plan. Same source bytes and policy produce the same hash.
 */
export function buildPlan(sourceDir) {
  const { discovery, parsed } = parseLegacySource(sourceDir);
  const items = [];
  const quarantined = [];
  const anomalies = [];

  for (const record of parsed.records) {
    const id = String(record.id ?? '');
    if (!id) {
      anomalies.push({ reason: 'record_without_id' });
      continue;
    }
    const raw = typeof record.raw === 'string' ? record.raw : null;
    const originTokens = originTokensOf(record.origin);
    const versionHash = sha256(Buffer.from(canonicalJson({
      id, raw, gist: record.gist ?? null, detail: record.detail ?? null,
      type: record.type ?? null, dueAt: record.dueAt ?? null,
      origin: originTokens, why: record.why ?? null,
      start: record.start ?? null, end: record.end ?? null,
    }), 'utf8'));
    if (record.scene !== 'work' && record.scene !== 'life' && record.scene !== 'both') {
      quarantined.push({ sourceObjectId: id, reason: 'unknown_scene', versionHash });
      continue;
    }
    const scope = record.scope === 'work-only' || record.scope === 'life-only' || record.scope === 'global'
      ? record.scope
      : null;
    if (!scope) {
      quarantined.push({ sourceObjectId: id, reason: 'unknown_scope', versionHash });
      continue;
    }
    const kind = record.kind === 'interval' ? 'interval' : 'point';
    if (kind === 'interval' && (!record.start || !record.end)) {
      quarantined.push({ sourceObjectId: id, reason: 'interval_bounds_missing', versionHash });
      continue;
    }
    const item = {
      itemId: `mem:${id}:${versionHash}`,
      itemKind: 'memory',
      sourceObjectId: id,
      sourceVersionHash: versionHash,
      payload: {
        id,
        kind,
        raw,
        gist: record.gist ?? null,
        detail: record.detail ?? record.gist ?? null,
        businessType: record.type ?? null,
        dueAt: record.dueAt ?? null,
        originTokens,
        why: record.why ?? null,
        scene: record.scene,
        scope,
        start: record.start ?? null,
        end: record.end ?? null,
        precision: record.precision ?? 'unknown',
        pointerStatus: record.pointer?.status === 'exact' ? 'exact' : 'unknown',
        pointerLocation: record.pointer?.status === 'exact' ? record.pointer.location ?? null : null,
        pointerSearchHint: record.pointer?.searchHint ?? null,
        topicText: record.topicText ?? null,
        rawMissing: raw === null,
      },
    };
    item.payloadHash = payloadHash(item.payload);
    items.push(item);
  }

  const graph = parsed.graph ?? { nodes: [] };
  for (const node of graph.nodes ?? []) {
    const item = {
      itemId: `node:${node.id}`,
      itemKind: 'graph_node',
      sourceObjectId: node.id,
      sourceVersionHash: sha256(Buffer.from(canonicalJson(node), 'utf8')),
      payload: { id: node.id, label: node.label, kind: node.kind ?? 'concept' },
    };
    item.payloadHash = payloadHash(item.payload);
    items.push(item);
  }
  const nodeIds = new Set((graph.nodes ?? []).map((node) => node.id));
  for (const edge of graph.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      quarantined.push({ sourceObjectId: edge.id, reason: 'dangling_edge', versionHash: null });
      continue;
    }
    const item = {
      itemId: `edge:${edge.id}`,
      itemKind: 'graph_edge',
      sourceObjectId: edge.id,
      sourceVersionHash: sha256(Buffer.from(canonicalJson(edge), 'utf8')),
      payload: { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind ?? 'related' },
    };
    item.payloadHash = payloadHash(item.payload);
    items.push(item);
  }

  const planBody = {
    policy: MAPPING_POLICY,
    sourceSystem: SOURCE_SYSTEM,
    sourceRoot: discovery.root,
    sourceFiles: discovery.files,
    items,
    quarantined,
    anomalies,
  };
  const planHash = sha256(Buffer.from(canonicalJson(planBody), 'utf8'));
  return { ...planBody, planHash };
}

export function loadPlan(planFile) {
  const text = fs.readFileSync(planFile, 'utf8');
  const plan = JSON.parse(text);
  const { planHash, ...body } = plan;
  const recomputed = sha256(Buffer.from(canonicalJson(body), 'utf8'));
  if (recomputed !== planHash) throw new WriteError('plan_hash_mismatch', { planFile });
  return plan;
}

function verifySourceUnchanged(plan) {
  for (const file of plan.sourceFiles) {
    const full = path.join(plan.sourceRoot, file.path);
    const digest = sha256(fs.readFileSync(full));
    if (digest !== file.sha256) throw new WriteError('source_changed', { file: file.path });
  }
}

function originTokensOf(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // plain string origin is still a single token
    }
    return [value];
  }
  if (value && typeof value === 'object') return Object.values(value).map(String).filter(Boolean);
  return [];
}

function observationRow({ sourceObjectId, versionHash, payload, at, origin }) {
  const id = objectId('obs', `obs:import:${SOURCE_SYSTEM}:${sourceObjectId}:${versionHash}`);
  const raw = payload.raw;
  const carrier = raw === null
    ? JSON.stringify({ legacyRecord: payload, raw_missing: true })
    : raw;
  return {
    id,
    idempotency_key: `obs:import:${SOURCE_SYSTEM}:${sourceObjectId}:${versionHash}`,
    at,
    payload_hash: payloadHash({ sourceSystem: SOURCE_SYSTEM, sourceObjectId, versionHash }),
    text: carrier,
    source: 'file',
    author_kind: 'unknown',
    runtime_refs: JSON.stringify({ import: true, sourceObjectId, raw_missing: raw === null }),
    origin,
    lossy: raw === null ? 1 : 0,
    state_snapshot: JSON.stringify({ phase: 'maintenance', energy: 'unknown', emotion: 'unknown' }),
    initial_strength: initialStrength(),
    recorded_at: at,
  };
}

export function applyPlan(deps, plan, { sourceRoot } = {}) {
  const { main, control, clock } = deps;
  const root = sourceRoot ? path.resolve(sourceRoot) : plan.sourceRoot;
  verifySourceUnchanged({ ...plan, sourceRoot: root });
  const working = { ...plan, sourceRoot: root };
  const appliedNow = [];
  const reused = [];
  let quarantined = plan.quarantined.length;

  for (const item of plan.items) {
    const existing = main
      .prepare(
        `SELECT * FROM import_items WHERE source_system = ? AND source_object_id = ?
           AND source_version_hash = ? AND item_kind = ? AND mapping_policy = ?`,
      )
      .get(SOURCE_SYSTEM, item.sourceObjectId, item.sourceVersionHash, item.itemKind, MAPPING_POLICY);
    if (existing) {
      if (existing.payload_hash !== item.payloadHash) {
        throw new WriteError('idempotency_conflict', { item: item.itemId });
      }
      reused.push(item.itemId);
      continue;
    }
    const at = clock.at().at;
    if (item.itemKind === 'memory') {
      applyMemoryItem({ main, control, clock, at }, item);
    } else if (item.itemKind === 'graph_node') {
      withImmediate(main, () => {
        main
          .prepare('INSERT INTO graph_nodes (id, label, kind, origin, source_ref, at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(item.payload.id, item.payload.label, item.payload.kind, canonicalJson([MIGRATED_ORIGIN]), `node:${item.payload.id}`, at);
        insertImportItem(main, item, at);
      });
    } else if (item.itemKind === 'graph_edge') {
      withImmediate(main, () => {
        const from = main.prepare('SELECT 1 AS ok FROM graph_nodes WHERE id = ?').get(item.payload.from);
        const to = main.prepare('SELECT 1 AS ok FROM graph_nodes WHERE id = ?').get(item.payload.to);
        if (!from || !to) {
          quarantined += 1;
          return;
        }
        main
          .prepare('INSERT INTO graph_edges (id, from_id, to_id, kind, origin, source_ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(item.payload.id, item.payload.from, item.payload.to, item.payload.kind, canonicalJson([MIGRATED_ORIGIN]), `edge:${item.payload.id}`, at);
        insertImportItem(main, item, at);
      });
    }
    appliedNow.push(item.itemId);
  }
  return { appliedNow, reused, quarantined, planHash: working.planHash };
}

function insertImportItem(main, item, at) {
  main
    .prepare(
      `INSERT INTO import_items (id, source_system, source_object_id, source_version_hash, item_kind, target_ids, mapping_policy, payload_hash, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      objectId('imp', `${SOURCE_SYSTEM}:${item.itemId}`),
      SOURCE_SYSTEM,
      item.sourceObjectId,
      item.sourceVersionHash,
      item.itemKind,
      JSON.stringify(item.targetIds ?? []),
      MAPPING_POLICY,
      item.payloadHash,
      at,
    );
}

function applyMemoryItem({ main, control, clock, at }, item) {
  const payload = item.payload;
  const origin = canonicalJson([...new Set([MIGRATED_ORIGIN, ...(payload.originTokens ?? [])])].sort());
  const observation = observationRow({ sourceObjectId: item.sourceObjectId, versionHash: item.sourceVersionHash, payload, at, origin });
  const existing = getObservation(main, observation.id);
  if (!existing) {
    const receipt = commitControlled({
      control,
      clock,
      spec: {
        objectKey: `main:${observation.id}`,
        targetDb: 'main',
        requestKey: `import-observation:${item.itemId}`,
        payloadHash: observation.payload_hash,
        immutablePayload: canonicalJson({ text: observation.text, source: 'file', authorKind: 'unknown', origin }),
        targetIds: [observation.id],
      },
      writeTxn: () => {
        if (!getObservation(main, observation.id)) insertObservation(main, observation);
      },
      readExact: () => {
        const row = getObservation(main, observation.id);
        return row ? { status: 'found', row } : { status: 'missing', reason: 'observation_absent' };
      },
    });
    if (receipt.status !== 'found') throw new WriteError('observation_write_failed');
  }

  const topic = payload.topicText
    ? resolveTopic(main, { entityRef: payload.topicText, attributeRef: 'migration_topic', objectRef: null }, {
        scopeId: payload.scope === 'life-only' ? 'life' : payload.scope === 'global' ? 'global' : 'work',
        observationId: item.sourceObjectId,
        sourceUnit: item.sourceVersionHash,
      })
    : { keyStatus: 'unresolved', topicKey: null, components: null, registryRevision: null };

  const candidateId = objectId('cand', `import:${item.itemId}`);
  const candidate = {
    id: candidateId,
    idempotency_key: `import:${item.itemId}`,
    at,
    payload_hash: payloadHash({ itemId: item.itemId, itemHash: item.payloadHash }),
    observation_id: observation.id,
    source_unit: item.sourceVersionHash,
    source_path: 'resolve',
    text: payload.raw ?? payload.gist ?? '',
    detail: payload.detail ?? payload.gist ?? null,
    why: payload.why ?? '迁移：旧数据无 why',
    type: payload.businessType ?? (payload.kind === 'interval' ? 'episode' : 'fact'),
    scene: payload.scene,
    scope: payload.scope,
    tags: canonicalJson([]),
    topic_key: topic.topicKey,
    topic_components: topic.components ? canonicalJson(topic.components) : null,
    registry_revision: topic.registryRevision,
    structured_value: null,
    semantic_status: 'proposed',
    record_kind: 'assertion',
    origin,
    confidence: 0.5,
    lossy: payload.rawMissing ? 1 : 0,
    start_at: payload.start,
    end_at: payload.end,
    prec_start: payload.start ? payload.precision : 'unknown',
    prec_end: payload.end ? payload.precision : 'unknown',
    time_state: payload.kind === 'interval' ? 'exact' : 'point',
    due_at: payload.dueAt ?? null,
    weight: 5,
    pointer_status: payload.pointerStatus,
    pointer_location: payload.pointerLocation,
    pointer_search_hint: payload.pointerSearchHint,
    judgment_id: null,
    creator_session_id: 'migration',
    owner_touched: 0,
    reason: 'migration',
    resolved_from: null,
    state_snapshot: JSON.stringify({ phase: 'maintenance', energy: 'unknown', emotion: 'unknown' }),
    initial_strength: initialStrength(),
    status: 'pending',
    promoted_at: null,
    rejected_reason: null,
    review_policy: 'candidate-v1',
    policy_revision: '1',
    deadline_at: null,
    created_input_seq: 0,
    recorded_at: at,
    key_status: topic.keyStatus,
    binding_status: 'proposed',
    binding_basis: canonicalJson({ ruleRevision: 'legacy-v1', policy: MAPPING_POLICY }),
    origin_mode: 'self',
  };
  const runtime = { role: 'maintenance', sessionId: 'migration', callId: item.itemId };
  withImmediate(main, () => {
    if (getCandidate(main, candidateId)) return;
    insertCandidate(main, candidate);
    insertEvidence(main, {
      id: objectId('ev', `import:${item.itemId}:basis`),
      memory_id: null,
      candidate_id: candidateId,
      observation_id: observation.id,
      source_memory_id: null,
      role: 'basis',
      source_span: `bytes:0:${Buffer.byteLength(observation.text, 'utf8')}`,
      at,
    });
    promoteInTransaction(main, { candidate, runtime, clock });
    const memoryRow = main.prepare('SELECT id FROM memories WHERE idempotency_key = ?').get(`promote:${candidateId}`);
    for (const target of [observation.id, candidateId, memoryRow?.id].filter(Boolean)) {
      void target;
    }
    appendRelation(main, {
      type: 'pointer-change',
      payload: {
        memoryId: memoryRow?.id ?? null,
        status: payload.pointerStatus,
        location: payload.pointerLocation,
        searchHint: payload.pointerSearchHint,
        basis: 'import',
        revision: 1,
      },
      businessKey: canonicalJson([memoryRow?.id ?? candidateId, 1]),
      at,
      keyEncoding: 'canonical',
      eventVersion: '2',
      payloadVersion: '2',
    });
    if (memoryRow) {
      main
        .prepare('UPDATE pointers SET status = ?, location = ?, search_hint = ?, revision = revision + 1 WHERE memory_id = ?')
        .run(payload.pointerStatus, payload.pointerLocation, payload.pointerSearchHint, memoryRow.id);
    }
    item.targetIds = [observation.id, candidateId, memoryRow?.id ?? null].filter(Boolean);
    insertImportItem(main, item, at);
  });
}

export function verifyPlan(deps, plan) {
  const { main } = deps;
  const report = { status: 'ok', items: 0, missing: [], unresolved: plan.quarantined.length, anomalies: (plan.anomalies ?? []).length, graph_nodes: 0, graph_edges: 0 };
  for (const item of plan.items) {
    const row = main
      .prepare(
        `SELECT * FROM import_items WHERE source_system = ? AND source_object_id = ?
           AND source_version_hash = ? AND item_kind = ? AND mapping_policy = ?`,
      )
      .get(SOURCE_SYSTEM, item.sourceObjectId, item.sourceVersionHash, item.itemKind, MAPPING_POLICY);
    if (!row) {
      report.missing.push(item.itemId);
      continue;
    }
    report.items += 1;
    if (item.itemKind === 'graph_node') {
      report.graph_nodes += 1;
      const node = main.prepare('SELECT * FROM graph_nodes WHERE id = ?').get(item.payload.id);
      if (!node) report.missing.push(`${item.itemId}:graph_node`);
      else if (node.label !== item.payload.label || node.kind !== item.payload.kind || node.source_ref !== `node:${item.payload.id}`) {
        report.missing.push(`${item.itemId}:graph_node_content`);
      }
    }
    if (item.itemKind === 'graph_edge') {
      report.graph_edges += 1;
      const edge = main.prepare('SELECT * FROM graph_edges WHERE id = ?').get(item.payload.id);
      if (!edge) report.missing.push(`${item.itemId}:graph_edge`);
      else if (
        edge.from_id !== item.payload.from ||
        edge.to_id !== item.payload.to ||
        edge.kind !== item.payload.kind ||
        edge.source_ref !== `edge:${item.payload.id}`
      ) {
        report.missing.push(`${item.itemId}:graph_edge_content`);
      }
    }
    if (item.itemKind === 'memory') {
      const targets = JSON.parse(row.target_ids);
      const observation = targets[0] ? getObservation(main, targets[0]) : null;
      if (!observation) {
        report.missing.push(`${item.itemId}:observation`);
        continue;
      }
      const expected = Buffer.from(JSON.stringify(item.payload.raw ?? ''), 'utf8');
      void expected;
      if (item.payload.raw !== null && observation.text !== item.payload.raw) {
        report.missing.push(`${item.itemId}:raw_mismatch`);
      }
      if (item.payload.raw === null && observation.text === item.payload.gist) {
        report.missing.push(`${item.itemId}:gist_as_observation`);
      }
      if (item.payload.raw === null && observation.lossy !== 1) {
        report.missing.push(`${item.itemId}:raw_missing_not_lossy`);
      }
      const memory = targets[2] ? getMemory(main, targets[2]) : null;
      if (!memory) report.missing.push(`${item.itemId}:memory`);
      if (memory) {
        const candidate = targets[1] ? getCandidate(main, targets[1]) : null;
        if (!candidate) report.missing.push(`${item.itemId}:candidate`);
        if (candidate) {
          if ((candidate.detail ?? null) !== (item.payload.detail ?? null)) {
            report.missing.push(`${item.itemId}:detail_mismatch`);
          }
          if (candidate.type !== (item.payload.businessType ?? (item.payload.kind === 'interval' ? 'episode' : 'fact'))) {
            report.missing.push(`${item.itemId}:type_mismatch`);
          }
          if ((candidate.due_at ?? null) !== (item.payload.dueAt ?? null)) {
            report.missing.push(`${item.itemId}:due_mismatch`);
          }
          for (const token of item.payload.originTokens ?? []) {
            if (!String(candidate.origin).includes(token)) {
              report.missing.push(`${item.itemId}:origin_missing:${token}`);
            }
          }
          if ((memory.detail ?? null) !== (item.payload.detail ?? null)) report.missing.push(`${item.itemId}:memory_detail_mismatch`);
          if (memory.type !== (item.payload.businessType ?? (item.payload.kind === 'interval' ? 'episode' : 'fact'))) report.missing.push(`${item.itemId}:memory_type_mismatch`);
          const dueQueue = main.prepare('SELECT deadline_at FROM due_queue WHERE memory_id = ?').get(memory.id);
          const effectiveDue = memory.due_at ?? dueQueue?.deadline_at ?? null;
          if (effectiveDue !== (item.payload.dueAt ?? null)) report.missing.push(`${item.itemId}:memory_due_mismatch`);
          for (const token of item.payload.originTokens ?? []) {
            if (!String(memory.origin).includes(token)) report.missing.push(`${item.itemId}:memory_origin_missing:${token}`);
          }
          const timeline = main.prepare('SELECT * FROM timeline WHERE memory_id = ?').get(memory.id);
          const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memory.id);
          const evidence = main.prepare('SELECT * FROM evidence WHERE memory_id = ? ORDER BY id').all(memory.id);
          if (!timeline || !pointer || evidence.length === 0) {
            report.missing.push(`${item.itemId}:projection_incomplete`);
          }
          if (timeline && (timeline.start_at ?? null) !== (item.payload.start ?? null)) report.missing.push(`${item.itemId}:timeline_start_mismatch`);
          if (timeline && (timeline.end_at ?? null) !== (item.payload.end ?? null)) report.missing.push(`${item.itemId}:timeline_end_mismatch`);
          const backfillRow = main
            .prepare("SELECT payload FROM relations WHERE type = 'pointer-change' AND json_extract(payload, '$.memoryId') = ? ORDER BY commit_seq DESC LIMIT 1")
            .get(memory.id);
          const backfill = backfillRow ? JSON.parse(backfillRow.payload) : null;
          const pointerBackfilled = Boolean(
            pointer &&
            backfill &&
            backfill.status === pointer.status &&
            backfill.location === pointer.location &&
            item.payload.pointerStatus === 'unknown',
          );
          if (pointer && pointer.status !== item.payload.pointerStatus && !pointerBackfilled) report.missing.push(`${item.itemId}:pointer_status_mismatch`);
          if (pointer && (pointer.location ?? null) !== (item.payload.pointerLocation ?? null) && !pointerBackfilled) report.missing.push(`${item.itemId}:pointer_location_mismatch`);
          for (const row of evidence) {
            const observationRow = row.observation_id ? main.prepare('SELECT * FROM observations WHERE id = ?').get(row.observation_id) : null;
            if (!observationRow) {
              report.missing.push(`${item.itemId}:evidence_observation_missing`);
              continue;
            }
            if (row.source_span !== `bytes:0:${Buffer.byteLength(observationRow.text, 'utf8')}`) {
              report.missing.push(`${item.itemId}:evidence_span_mismatch`);
            }
            if (Buffer.byteLength(observationRow.text, 'utf8') === 0) report.missing.push(`${item.itemId}:evidence_empty`);
          }
        }
      }
      if (memory && !item.payload.rawMissing && memory.text !== item.payload.raw) {
        report.missing.push(`${item.itemId}:text_mismatch`);
      }
      const pointer = main.prepare('SELECT * FROM pointers WHERE memory_id = ?').get(memory?.id);
      if (pointer) {
        const lastChange = main
          .prepare("SELECT * FROM relations WHERE type = 'pointer-change' AND json_extract(payload, '$.memoryId') = ? ORDER BY commit_seq DESC LIMIT 1")
          .get(memory.id);
        const target = lastChange ? JSON.parse(lastChange.payload) : null;
        if (target && (pointer.status !== target.status || (pointer.location ?? null) !== (target.location ?? null))) {
          report.missing.push(`${item.itemId}:pointer_mismatch`);
        }
      }
    }
  }
  report.status = report.missing.length === 0 ? 'ok' : 'failed';
  return report;
}

export { sha256 };

export function cutoverGate(verify) {
  if (!verify || verify.status !== 'ok') return 'verify_failed';
  if (Number(verify.anomalies ?? 0) > 0) return 'anomalies_present';
  if (Number(verify.unresolved ?? 0) > 0) return 'unresolved_items';
  return null;
}
