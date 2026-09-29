import fs from "node:fs";
import {fileURLToPath} from "node:url";

const REGISTRY_PATH = new URL("../fixtures/runtime-surface-parity.json", import.meta.url);
export const RUNTIME_SURFACE_PARITY = JSON.parse(fs.readFileSync(fileURLToPath(REGISTRY_PATH), "utf8"));
export const RUNTIME_SURFACE_PARITY_SCHEMA = RUNTIME_SURFACE_PARITY.schema;

const SURFACES = new Map(RUNTIME_SURFACE_PARITY.surfaces.map((surface) => [surface.surface_id, surface]));
const INDEPENDENT_FINDINGS = new Set([
  "candidate_asset_missing",
  "candidate_image_missing",
  "unresolved_include",
]);
const ROLE_SURFACES = new Map([
  ["rating_widget", "content.rating"],
  ["article", "content.article"],
  ["navigation", "nav.top"],
  ["sidebar", "nav.sidebar"],
]);
const INTERACTION_SURFACES = new Map([
  ["tabs", "content.tabview"],
  ["tabview", "content.tabview"],
  ["collapsible", "content.collapsible"],
  ["rating", "content.rating"],
  ["credit", "content.credit"],
]);

const REGEX_CACHE = new Map();
function surfaceMatchesText(surface, text) {
  if (!text) return false;
  for (const source of surface.selector_patterns ?? []) {
    let pattern = REGEX_CACHE.get(source);
    if (!pattern) {
      pattern = new RegExp(source, "iu");
      REGEX_CACHE.set(source, pattern);
    }
    if (pattern.test(text)) return true;
  }
  return false;
}

function inferredSurfaceIds(finding) {
  const ids = new Set();
  const direct = finding.surface;
  if (typeof direct === "string" && SURFACES.has(direct)) {
    const directSurface = SURFACES.get(direct);
    if (directSurface.conclusion_resolution === "NO_CURRENT_DEPENDENCY") {
      ids.add("unclassified-runtime-surface");
    } else {
      ids.add(direct);
      if (directSurface.conclusion_resolution === "CERTIFIED_PARITY_SCOPE") return [...ids].sort();
    }
  }
  const roleSurface = ROLE_SURFACES.get(finding.reference_role);
  if (roleSurface) ids.add(roleSurface);
  const interactionSurface = INTERACTION_SURFACES.get(finding.interaction ?? finding.component);
  if (interactionSurface) ids.add(interactionSurface);

  const selectors = [
    finding.selector,
    finding.anchor,
    finding.component,
    finding.evidence?.selector,
    ...(finding.overflow_sources ?? []).flatMap((source) => [source?.selector, ...(source?.ancestors ?? [])]),
  ].filter((value) => typeof value === "string");
  for (const surface of SURFACES.values()) {
    // The page.diff row is retained as an explicit non-dependency. Its
    // revision-diff selectors are already analyzed under the active History
    // surface; a future direct page.diff observation is routed to the
    // fail-closed fallback above.
    if (surface.conclusion_resolution === "NO_CURRENT_DEPENDENCY") continue;
    if (selectors.some((selector) => surfaceMatchesText(surface, selector))) ids.add(surface.surface_id);
  }
  return [...ids].sort();
}

function failClosedSurface(surfaceId) {
  return SURFACES.get(surfaceId) ?? SURFACES.get("unclassified-runtime-surface");
}

export function parityReviewForSurfaceIds(surfaceIds, {unmatchedIsRuntime = true} = {}) {
  const rows = [...new Set(surfaceIds)].map((surfaceId) => {
    const surface = failClosedSurface(surfaceId);
    // Registry rows with no current harness dependency are not authority to
    // disregard a direct runtime observation. If one is observed, route it
    // through the same fail-closed path as any other unclassified contract.
    return surface?.conclusion_resolution === "NO_CURRENT_DEPENDENCY"
      ? failClosedSurface("unclassified-runtime-surface")
      : surface;
  }).filter(Boolean);
  const surfaces = rows.length
    ? rows
    : unmatchedIsRuntime
      ? [failClosedSurface("unclassified-runtime-surface")]
      : [];
  const mayTreatAsPortRequirement = surfaces.length > 0 && surfaces.every((surface) =>
    surface.conclusion_resolution === "CERTIFIED_PARITY_SCOPE" &&
    surface.status === "PARITY_CERTIFIED" &&
    surface.may_treat_differences_as_port_requirements === true,
  );
  const blocksPortConclusion = surfaces.some((surface) => surface.blocks_port_conclusion === true);
  const hasTargetAcceptanceSurface = surfaces.some((surface) =>
    ["LOCAL_TARGET_ACCEPTANCE_ONLY", "COVERED_BY_ACTIVE_SURFACE"].includes(surface.conclusion_resolution),
  );
  const hasSyntheticDiagnostic = surfaces.some((surface) =>
    surface.conclusion_resolution === "SYNTHETIC_DIAGNOSTIC_ONLY",
  );
  const status = mayTreatAsPortRequirement
    ? "PARITY_CERTIFIED"
    : surfaces.find((surface) => surface.status === "PARITY_MISMATCH")?.status
      ?? surfaces.find((surface) => surface.status === "THEME_LAB_ONLY_SYNTHETIC_SURFACE")?.status
      ?? "INSUFFICIENT_EVIDENCE";
  return {
    status,
    surface_ids: surfaces.map((surface) => surface.surface_id),
    may_treat_differences_as_port_requirements: mayTreatAsPortRequirement,
    port_conclusion_eligible: mayTreatAsPortRequirement,
    blocks_port_conclusion: blocksPortConclusion,
    quarantined: !mayTreatAsPortRequirement,
    conclusion_resolution: mayTreatAsPortRequirement
      ? "CERTIFIED_PARITY_SCOPE"
      : blocksPortConclusion
        ? "BLOCK_IF_OBSERVED"
        : hasTargetAcceptanceSurface
          ? "LOCAL_TARGET_ACCEPTANCE_ONLY"
          : hasSyntheticDiagnostic
            ? "SYNTHETIC_DIAGNOSTIC_ONLY"
            : "NO_PORT_CONCLUSION_AUTHORITY",
    decision_authority: mayTreatAsPortRequirement
      ? "WIKIDOT_RUNTIME_PARITY"
      : blocksPortConclusion
        ? "UNCLASSIFIED_RUNTIME_FAIL_CLOSED"
        : hasTargetAcceptanceSurface
          ? "SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY"
          : hasSyntheticDiagnostic
            ? "THEME_LAB_SYNTHETIC_DIAGNOSTIC_ONLY"
            : "NONE_CURRENTLY",
    reason: mayTreatAsPortRequirement
      ? "Every matched contract is certified for the exact registered scope."
      : blocksPortConclusion
        ? "An observed runtime contract has no resolved parity disposition; the port conclusion is blocked."
        : hasTargetAcceptanceSurface
          ? "The finding remains in SCP-JP local target acceptance; it cannot establish Wikidot parity or a parity-based port requirement."
          : hasSyntheticDiagnostic
            ? "The synthetic Theme Lab fixture state is diagnostic only and has no Wikidot parity authority."
            : "No current Theme Lab port-decision dependency is registered for this finding.",
  };
}

export function reviewRuntimeSurfaceFinding(finding) {
  if (INDEPENDENT_FINDINGS.has(finding.kind)) {
    return {
      status: "NOT_RUNTIME_SURFACE",
      surface_ids: [],
      may_treat_differences_as_port_requirements: true,
      port_conclusion_eligible: true,
      blocks_port_conclusion: false,
      quarantined: false,
      conclusion_resolution: "RUNTIME_INDEPENDENT_CANDIDATE_CHECK",
      decision_authority: "RUNTIME_INDEPENDENT_CANDIDATE_CHECK",
      reason: "This finding concerns a candidate dependency or include, not Wikidot-facing runtime parity.",
    };
  }
  return parityReviewForSurfaceIds(inferredSurfaceIds(finding));
}

export function annotateRuntimeSurfaceUsage(usage = {}) {
  return {
    ...usage,
    surfaces: (usage.surfaces ?? []).map((surface) => ({
      ...surface,
      parity_review: parityReviewForSurfaceIds([surface.id]),
    })),
  };
}

export function applyRuntimeSurfaceParityGate(issues = [], styleChanges = []) {
  const reviewedIssues = issues.map((issue) => ({
    ...issue,
    parity_review: reviewRuntimeSurfaceFinding(issue),
  }));
  const reviewedStyleChanges = styleChanges.map((change) => ({
    ...change,
    parity_review: reviewRuntimeSurfaceFinding({kind: "style_change", anchor: change.anchor}),
  }));
  const quarantined = [
    ...reviewedIssues.filter((issue) => issue.parity_review.quarantined).map((issue) => ({
      kind: issue.kind,
      surface_ids: issue.parity_review.surface_ids,
      selector: issue.selector ?? issue.anchor ?? null,
      status: issue.parity_review.status,
      blocks_port_conclusion: issue.parity_review.blocks_port_conclusion,
    })),
    ...reviewedStyleChanges.filter((change) => change.parity_review.quarantined).map((change) => ({
      kind: "style_change",
      surface_ids: change.parity_review.surface_ids,
      selector: change.anchor,
      status: change.parity_review.status,
      blocks_port_conclusion: change.parity_review.blocks_port_conclusion,
    })),
  ];
  return {
    issues: reviewedIssues,
    styleChanges: reviewedStyleChanges,
    summary: {
      schema: RUNTIME_SURFACE_PARITY_SCHEMA,
      status: reviewedIssues.some((issue) => issue.parity_review.blocks_port_conclusion)
        || reviewedStyleChanges.some((change) => change.parity_review.blocks_port_conclusion)
        ? "required_runtime_dependency_unresolved"
        : quarantined.length
          ? "non_authoritative_target_findings_present"
          : "eligible_or_independent_only",
      port_requirement_eligible_count: reviewedIssues.filter((issue) => !issue.parity_review.quarantined).length
        + reviewedStyleChanges.filter((change) => !change.parity_review.quarantined).length,
      quarantined_count: quarantined.length,
      target_acceptance_only_count: reviewedIssues.filter((issue) => issue.parity_review.conclusion_resolution === "LOCAL_TARGET_ACCEPTANCE_ONLY").length
        + reviewedStyleChanges.filter((change) => change.parity_review.conclusion_resolution === "LOCAL_TARGET_ACCEPTANCE_ONLY").length,
      required_uncertified_count: reviewedIssues.filter((issue) => issue.parity_review.blocks_port_conclusion).length
        + reviewedStyleChanges.filter((change) => change.parity_review.blocks_port_conclusion).length,
      quarantined_findings: quarantined,
    },
  };
}
