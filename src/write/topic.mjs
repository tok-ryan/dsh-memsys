import { canonicalJson, sha256Hex } from '../identity.mjs';
import { getConfigValue } from '../storage/repositories.mjs';

export const UNRESOLVED_PREFIX = 'unresolved:';

/** Alias normalisation keeps punctuation and negations ("不" is never removed). */
export function normalizeAlias(text) {
  return String(text).normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function registryOf(db) {
  return getConfigValue(db, 'registry')?.value ?? null;
}

/** topic_key = tk: + SHA-256 of the canonical five-tuple; the value never enters it. */
export function buildTopicKey({ entityId, attributeId, objectIdOrNull, scopeId }) {
  return `tk:${sha256Hex(
    canonicalJson(['topic-v1', entityId, attributeId, objectIdOrNull ?? null, scopeId]),
  )}`;
}

/** Unresolved key binds to the observation span, not to a model-chosen theme word. */
export function unresolvedTopicKey(observationId, sourceUnit) {
  return `${UNRESOLVED_PREFIX}${sha256Hex(canonicalJson([observationId, sourceUnit]))}`;
}

/** Mechanical candidate-entity id (mention only, no definition or authority). */
export function candidateEntityId(observationId, sourceSpan, scopeId) {
  return `ce:${sha256Hex(canonicalJson([observationId, sourceSpan, scopeId]))}`;
}

function resolveEntity(registry, ref) {
  if (!ref) return { id: null, reason: 'missing_entity_ref' };
  const direct = registry.entity_registry.find((entry) => entry.id === ref);
  if (direct) return { id: direct.id, reason: null };
  const wanted = normalizeAlias(ref);
  const aliasHits = (registry.alias_registry ?? []).filter(
    (entry) => normalizeAlias(entry.alias) === wanted,
  );
  if (aliasHits.length === 0) return { id: null, reason: 'alias_zero_hit' };
  if (aliasHits.length > 1) return { id: null, reason: 'alias_multi_hit' };
  return { id: aliasHits[0].entityId, reason: null };
}

/**
 * Resolve a model-suggested topic. All five components must be registered and
 * unambiguous; otherwise the key stays unresolved and the memory is ungrouped.
 * Binding status is always `proposed` for model suggestions.
 */
export function resolveTopic(db, components, { scopeId, observationId, sourceUnit }) {
  const registry = registryOf(db);
  const fallback = {
    topicKey: unresolvedTopicKey(observationId, sourceUnit),
    keyStatus: 'unresolved',
    bindingStatus: 'proposed',
    registryRevision: registry?.revision ?? null,
    components: components ?? null,
  };
  if (!components) return { ...fallback, reason: 'no_components' };
  if (!registry) return { ...fallback, reason: 'registry_missing' };

  const attribute = registry.attribute_registry.find(
    (entry) => entry.id === components.attributeRef,
  );
  if (!attribute) return { ...fallback, reason: 'attribute_unregistered' };
  if (!attribute.scopes.includes(scopeId)) return { ...fallback, reason: 'attribute_scope_mismatch' };

  const entity = resolveEntity(registry, components.entityRef);
  if (!entity.id) return { ...fallback, reason: entity.reason };

  let objectId = null;
  if (components.objectRef) {
    const object = resolveEntity(registry, components.objectRef);
    if (!object.id) return { ...fallback, reason: object.reason };
    objectId = object.id;
  }

  return {
    topicKey: buildTopicKey({
      entityId: entity.id,
      attributeId: attribute.id,
      objectIdOrNull: objectId,
      scopeId,
    }),
    keyStatus: 'resolved',
    bindingStatus: 'proposed',
    registryRevision: registry.revision ?? null,
    components,
    reason: null,
  };
}

export function isUnresolved(topicKey) {
  return typeof topicKey === 'string' && topicKey.startsWith(UNRESOLVED_PREFIX);
}
