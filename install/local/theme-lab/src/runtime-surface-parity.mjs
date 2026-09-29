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
  if (typeof direct === "string" && SURFACES.has(direct)) ids.add(direct);
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
    if (selectors.some((selector) => surfaceMatchesText(surface, selector))) ids.add(surface.surface_id);
  }
  return [...ids].sort();
}

function failClosedSurface(surfaceId) {
  return SURFACES.get(surfaceId) ?? SURFACES.get("unclassified-runtime-surface");
}

export function parityReviewForSurfaceIds(surfaceIds, {unmatchedIsRuntime = true} = {}) {
  const rows = [...new Set(surfaceIds)].map(failClosedSurface).filter(Boolean);
  const surfaces = rows.length
    ? rows
    : unmatchedIsRuntime
      ? [failClosedSurface("unclassified-runtime-surface")]
      : [];
  const mayTreatAsPortRequirement = surfaces.length > 0 && surfaces.every((surface) =>
    surface.status === "PARITY_CERTIFIED" && surface.may_treat_differences_as_port_requirements === true,
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
    quarantined: !mayTreatAsPortRequirement,
    reason: mayTreatAsPortRequirement
      ? "All matched runtime surface scopes are parity-certified."
      : "Runtime surface parity is not certified for the finding's full observable scope.",
  };
}

export function reviewRuntimeSurfaceFinding(finding) {
  if (INDEPENDENT_FINDINGS.has(finding.kind)) {
    return {
      status: "NOT_RUNTIME_SURFACE",
      surface_ids: [],
      may_treat_differences_as_port_requirements: true,
      quarantined: false,
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
    })),
    ...reviewedStyleChanges.filter((change) => change.parity_review.quarantined).map((change) => ({
      kind: "style_change",
      surface_ids: change.parity_review.surface_ids,
      selector: change.anchor,
      status: change.parity_review.status,
    })),
  ];
  return {
    issues: reviewedIssues,
    styleChanges: reviewedStyleChanges,
    summary: {
      schema: RUNTIME_SURFACE_PARITY_SCHEMA,
      status: quarantined.length ? "quarantined_findings_present" : "eligible_or_independent_only",
      port_requirement_eligible_count: reviewedIssues.filter((issue) => !issue.parity_review.quarantined).length
        + reviewedStyleChanges.filter((change) => !change.parity_review.quarantined).length,
      quarantined_count: quarantined.length,
      quarantined_findings: quarantined,
    },
  };
}
