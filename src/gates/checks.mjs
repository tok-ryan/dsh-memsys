import { toolCapabilityStatus } from '../runtime/tools.mjs';
import { requestDueRetreat } from '../write/due-actions.mjs';
import { SURFACE_METRIC, SURFACE_THRESHOLD, SURFACE_CALIBRATION_TODO } from '../dream/surface.mjs';

/**
 * Offline gates are assertions that must be able to fail. A gate "passed" means
 * the honesty assertion held; it does not promote an unknown capability.
 */
export function gateToolRegistration({ liveReport = null } = {}) {
  const capability = toolCapabilityStatus(liveReport);
  const ok =
    capability.status === 'passed'
      ? liveReport?.tools?.result === 'ok' && liveReport?.tools?.schemas_has_memsys === true && liveReport?.tools?.get_found === true
      : capability.status === 'unknown' && !capability.evidence;
  return {
    id: 'tool_registration',
    ok,
    capability_status: capability.status,
    assertion:
      capability.status === 'passed'
        ? 'tool registration has dynamic evidence and only then becomes passed'
        : 'tool registration is unverified and must stay unknown',
    evidence: { capability },
  };
}

export function gateDueRetreat({ main }) {
  const policyApproved = Boolean(
    main.prepare("SELECT 1 AS ok FROM state WHERE key = 'due-policy:due-policy-v1'").get()?.ok,
  );
  const retreat = requestDueRetreat(main);
  const retreatEvents = main
    .prepare("SELECT COUNT(*) AS n FROM relations WHERE type = 'due-retreat'")
    .get();
  const ok =
    policyApproved === false &&
    retreat.ok === false &&
    retreat.code === 'due_retreat_unavailable' &&
    Number(retreatEvents.n) === 0;
  return {
    id: 'due_retreat',
    ok,
    assertion: ok
      ? 'unapproved due-policy cannot reach the retreat path; only refusal + report'
      : 'retreat path was reachable or silently wrote events',
    evidence: { policyApproved, retreat, retreatEvents: Number(retreatEvents.n) },
  };
}

export function gateDreamSurface() {
  const ok = SURFACE_METRIC === 'freshness' && SURFACE_THRESHOLD === 0.45 && Boolean(SURFACE_CALIBRATION_TODO);
  return {
    id: 'dream_surface_threshold',
    ok,
    assertion: ok
      ? 'surface currently uses the freshness dimension only; recalibration is recorded as a todo'
      : 'surface metric drifted from the recorded contract',
    evidence: { metric: SURFACE_METRIC, threshold: SURFACE_THRESHOLD, calibration_todo: SURFACE_CALIBRATION_TODO },
  };
}

/** Cross-check the restore batch high-water against the live target. */
export function crossCheckHighWater({ restoreReport, targetMainSeq, targetControlGeneration = null }) {
  const restoredMain = Number(restoreReport?.restored_main_commit_seq);
  if (!Number.isFinite(restoredMain)) {
    return { ok: false, reason: 'restore_report_missing_high_water' };
  }
  if (Number(targetMainSeq) < restoredMain) {
    return { ok: false, reason: 'target_behind_restore', restoredMain, targetMainSeq: Number(targetMainSeq) };
  }
  if (restoreReport.restored_control_generation !== undefined && targetControlGeneration !== null) {
    if (Number(targetControlGeneration) < Number(restoreReport.restored_control_generation)) {
      return { ok: false, reason: 'control_generation_behind_restore' };
    }
  }
  return { ok: true, restoredMain, targetMainSeq: Number(targetMainSeq) };
}

export function gateCutoverHighWater({ restoreReport, targetMainSeq, targetControlGeneration = null }) {
  const checked = crossCheckHighWater({ restoreReport, targetMainSeq, targetControlGeneration });
  const rejectsLower = !crossCheckHighWater({ restoreReport, targetMainSeq: checked.restoredMain - 1 }).ok;
  const rejectsMissing = !crossCheckHighWater({ restoreReport: {}, targetMainSeq: targetMainSeq }).ok;
  const ok = checked.ok && rejectsLower && rejectsMissing;
  return {
    id: 'cutover_high_water',
    ok,
    assertion: ok
      ? 'restore batch high-water is cross-checked; lower/missing targets are refused'
      : 'cutover could pass without a high-water cross-check',
    evidence: { checked, rejectsLower, rejectsMissing },
  };
}

export function gateEvidenceMean({ searchResult }) {
  const hits = Number(searchResult?.direct_hit_count ?? 0);
  const meanOk = hits > 0
    ? typeof searchResult.evidence_mean === 'number' && searchResult.evidence_mean_status === 'ok'
    : searchResult?.evidence_mean === null && searchResult?.evidence_mean_status === 'unavailable';
  const ok = searchResult && meanOk && searchResult.relation_search === 'unavailable';
  return {
    id: 'evidence_mean_null',
    ok,
    assertion: ok
      ? 'no skeleton means evidence_mean stays null with an explicit unavailable status'
      : 'evidence_mean was invented or the unavailable status was lost',
    evidence: {
      direct_hit_count: searchResult?.direct_hit_count ?? null,
      evidence_mean: searchResult?.evidence_mean ?? null,
      evidence_mean_status: searchResult?.evidence_mean_status ?? null,
      relation_search: searchResult?.relation_search ?? null,
    },
  };
}

export function gateRequireLive({ requireLive, liveReport = null }) {
  if (!requireLive) {
    return {
      id: 'require_live',
      ok: true,
      dynamic_status: 'unknown',
      reason: 'dynamic_evidence_not_requested',
      assertion: 'offline mode never promotes dynamic capability to passed',
    };
  }
  if (!liveReport) {
    return {
      id: 'require_live',
      ok: false,
      dynamic_status: 'not_run',
      reason: 'dynamic_not_run',
      assertion: 'required dynamic evidence is missing; exit must be non-zero',
    };
  }
  if (liveReport.status === 'failed') {
    return {
      id: 'require_live',
      ok: false,
      dynamic_status: 'failed',
      reason: 'dynamic_failed',
      assertion: 'dynamic evidence ran and failed; exit must be non-zero',
    };
  }
  const hasEvidence =
    liveReport.status === 'passed' &&
    (liveReport.case === 'tools'
      ? liveReport.tools?.result === 'ok' && liveReport.tools?.schemas_has_memsys === true && liveReport.tools?.get_found === true
      : liveReport.case === 'inject'
        ? liveReport.section?.name === 'memsys:context' &&
          Number(liveReport.section?.order) === 500 &&
          liveReport.section?.result === 'ok'
        : false);
  if (!hasEvidence) {
    return {
      id: 'require_live',
      ok: false,
      dynamic_status: 'unknown',
      reason: 'dynamic_evidence_incomplete',
      assertion: 'only status=passed with required fields counts as dynamic evidence',
    };
  }
  return {
    id: 'require_live',
    ok: true,
    dynamic_status: 'passed',
    reason: null,
    assertion: 'dynamic evidence provided and passed',
  };
}
