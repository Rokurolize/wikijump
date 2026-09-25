// Compact, agent-facing verdict construction.
//
// The raw browser/selector/torture data is large. An LLM wants a small ranked
// list of "what broke and where" plus a short list of style changes, and only
// asks for raw detail explicitly.

export const DEFAULT_LIMITS = Object.freeze({
  topIssues: 12,
  styleChanges: 10,
  selectorRows: 30,
});

function severityRank(severity) {
  return {error: 0, warn: 1, info: 2}[severity] ?? 3;
}

export function issuesFromSelectorDiagnosis(diagnosis) {
  const issues = [];
  for (const row of diagnosis?.missing ?? []) {
    const mapping = row.semantic_mapping;
    issues.push({
      severity: "error",
      kind: "missing_selector",
      selector: row.selector,
      reference: row.reference,
      candidate: row.candidate,
      at_context: row.at_context ?? [],
      ...(mapping?.reference_role ? {reference_role: mapping.reference_role} : {}),
      ...(mapping?.candidate_candidates?.length
        ? {suggested_candidate: mapping.candidate_candidates[0]}
        : {}),
    });
  }
  for (const row of diagnosis?.collapsed ?? []) {
    issues.push({
      severity: "warn",
      kind: "collapsed_selector",
      selector: row.selector,
      reference: row.reference,
      candidate: row.candidate,
      at_context: row.at_context ?? [],
    });
  }
  for (const row of diagnosis?.expanded ?? []) {
    issues.push({
      severity: "warn",
      kind: "expanded_selector",
      selector: row.selector,
      reference: row.reference,
      candidate: row.candidate,
      at_context: row.at_context ?? [],
    });
  }
  return issues;
}

export function issuesFromTorture(torture) {
  if (!torture?.issues) return [];
  return torture.issues.map((issue) => ({
    severity: issue.severity ?? "error",
    kind: issue.kind,
    component: issue.component,
    viewport: issue.viewport,
    ...(issue.selector ? {selector: issue.selector} : {}),
    ...(issue.before_px !== undefined ? {before_px: issue.before_px} : {}),
    ...(issue.after_px !== undefined ? {after_px: issue.after_px} : {}),
    ...(issue.overflow_sources ? {overflow_sources: issue.overflow_sources} : {}),
    ...(issue.element_rect ? {element_rect: issue.element_rect} : {}),
    ...(issue.computed ? {computed: issue.computed} : {}),
  }));
}

export function issuesFromViewports(viewports) {
  const issues = [];
  for (const [id, viewport] of Object.entries(viewports ?? {})) {
    const overflow = viewport?.document_overflow_px ?? 0;
    // viewportStatus fails for any positive document overflow; use the same
    // boundary here so a failed viewport always has an actionable issue.
    if (overflow > 0) {
      issues.push({severity: "error", kind: "viewport_overflow", viewport: id, overflow_px: overflow, overflow_sources: viewport?.overflow_sources ?? []});
    }
  }
  return issues;
}

export function issuesFromPreview(preview) {
  return (preview?.unresolved_includes ?? []).map(({page, message}) => ({
    severity: "error",
    kind: "unresolved_include",
    include: page,
    evidence: message,
  }));
}

function issuesFromInteractions(interactions) {
  if (!interactions) return [];
  return Object.entries(interactions)
    .filter(([, result]) => result?.status === "fail")
    .map(([interaction, result]) => ({severity: "error", kind: "interaction_failure", interaction, evidence: result}));
}

export function styleChangesFromComputed(computedStyles, limit = DEFAULT_LIMITS.styleChanges) {
  const priority = (property) => {
    if (/^(font-|color$|background-|border-|width$|margin-|padding-)/u.test(property)) return 0;
    if (property.startsWith("rect.") && property !== "rect.y" && property !== "rect.height") return 1;
    return 2;
  };
  return [...(computedStyles?.top ?? [])].sort((a, b) => priority(a.property) - priority(b.property)).slice(0, limit).map((row) => ({
    anchor: row.anchor,
    property: row.property,
    reference: row.reference,
    candidate: row.candidate,
    delta: row.delta,
    status: row.status,
    ...(row.cascade
      ? {
          cascade: {
            status: row.cascade.status,
            winner: row.cascade.winner,
            media_inactive: row.cascade.media_inactive,
            variables: row.cascade.variables,
          },
        }
      : {}),
  }));
}

export function nextActions(issues, styleChanges = [], limit = 5) {
  const actions = [];
  for (const issue of issues) {
    if (issue.kind === "missing_selector") {
      actions.push({
        kind: issue.suggested_candidate ? "rewrite_selector" : "supply_candidate_structure",
        selector: issue.selector,
        ...(issue.suggested_candidate ? {suggested_candidate: issue.suggested_candidate} : {}),
        evidence: {reference_count: issue.reference, candidate_count: issue.candidate},
      });
    } else if (issue.kind === "candidate_asset_missing") {
      actions.push({kind: "provide_asset", asset: issue.asset, evidence: {missing_from_asset_dir: true}});
    } else if (issue.kind === "candidate_image_missing") {
      actions.push({kind: "localize_image", asset: issue.asset, selector: issue.selector, evidence: issue.evidence});
    } else if (issue.kind === "unresolved_include") {
      actions.push({
        kind: "resolve_candidate_include",
        include: issue.include,
        evidence: {preview_error: issue.evidence},
      });
    } else if (issue.kind === "interaction_failure") {
      actions.push({kind: "repair_interaction", interaction: issue.interaction, evidence: issue.evidence});
    } else if (issue.kind?.includes("overflow")) {
      actions.push({
        kind: "reduce_overflow",
        component: issue.component,
        viewport: issue.viewport,
        ...(issue.selector ? {selector: issue.selector} : {}),
        evidence: {before_px: issue.before_px ?? 0, after_px: issue.after_px ?? issue.overflow_px ?? 0},
        ...(issue.overflow_sources?.length ? {overflow_sources: issue.overflow_sources} : {}),
      });
    }
    if (actions.length >= limit) return actions;
  }
  for (const change of styleChanges) {
    // A different computed value is not, by itself, a repair action: theme
    // ports deliberately change fonts and colors. Surface only a concrete
    // cascade clue that could explain an unresolved difference.
    if (!change.cascade?.winner || !change.cascade.media_inactive?.length) continue;
    actions.push({
      kind: "inspect_inactive_media",
      selector: change.anchor,
      property: change.property,
      evidence: {
        reference: change.reference,
        candidate: change.candidate,
        winner: change.cascade.winner,
        media_inactive: change.cascade.media_inactive,
      },
    });
    if (actions.length >= limit) break;
  }
  return actions;
}

export function summarizeVisual(visual) {
  if (!visual) return null;
  const viewports = {};
  let worst = "pass";
  for (const [id, entry] of Object.entries(visual)) {
    if (!entry.comparison) {
      viewports[id] = {status: "captured"};
      continue;
    }
    viewports[id] = {
      status: entry.comparison.status,
      normalized_rmse: entry.comparison.normalized_rmse ?? null,
    };
    if (entry.comparison.status === "fail") worst = "fail";
    else if (entry.comparison.status === "unavailable" && worst === "pass") worst = "unavailable";
  }
  return {status: worst, viewports};
}

export function buildVerdict({
  reference = null,
  torture = null,
  viewports = null,
  fontDiagnostics = null,
  interactionDiagnostics = null,
  imageDiagnostics = null,
  pageImageAssets = null,
  visual = null,
  timing = {},
  artifacts = {},
  assets = null,
  preview = null,
  extraIssues = [],
  limits = DEFAULT_LIMITS,
} = {}) {
  const issues = [
    ...issuesFromSelectorDiagnosis(reference?.diagnosis),
    ...issuesFromTorture(torture),
    ...issuesFromViewports(viewports),
    ...issuesFromPreview(preview),
    ...issuesFromInteractions(interactionDiagnostics),
    ...(imageDiagnostics?.broken ?? []).map((image) => ({
      severity: "error",
      kind: "candidate_image_missing",
      asset: image.src,
      selector: image.selector,
      evidence: {alt: image.alt, natural_width: image.natural_width, natural_height: image.natural_height},
    })),
    ...extraIssues,
  ];
  issues.sort((left, right) => severityRank(left.severity) - severityRank(right.severity));

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarn = issues.some((issue) => issue.severity === "warn");
  const styleChanges = styleChangesFromComputed(reference?.computed_styles, limits.styleChanges);
  // Geometry/font changes are not errors, but they should still raise the
  // verdict to "warn" so an agent notices them without a failure.
  const hasTortureChanges = (torture?.changed_component_count ?? 0) > 0;

  const verdict = hasError ? "fail" : hasWarn || styleChanges.length > 0 || hasTortureChanges ? "warn" : "pass";
  const viewportStatus = viewports
    ? Object.fromEntries(Object.entries(viewports).map(([name, result]) => [name, {
        status: (result.document_overflow_px ?? 0) > 0 ? "fail" : "pass",
        document_overflow_px: result.document_overflow_px ?? 0,
      }]))
    : null;
  const proposedActions = nextActions(issues, styleChanges);
  // Inactive media rules are useful leads before responsive evidence exists.
  // Once the complete viewport sweep has passed, those leads have been
  // exercised and should remain visible as style evidence rather than asking
  // for an edit with no failing viewport to reproduce.
  const resolvedActions = viewportStatus && Object.values(viewportStatus).length > 0 &&
    Object.values(viewportStatus).every((entry) => entry.status === "pass")
    ? proposedActions.filter((action) => action.kind === "inspect_inactive_media")
    : [];
  const actionableActions = resolvedActions.length
    ? proposedActions.filter((action) => action.kind !== "inspect_inactive_media")
    : proposedActions;

  return {
    verdict,
    timing_ms: timing,
    issue_count: issues.length,
    top_issues: issues.slice(0, limits.topIssues),
    style_changes: styleChanges,
    next_actions: actionableActions,
    ...(resolvedActions.length ? {resolved_actions: resolvedActions.map((action) => ({
      ...action,
      resolution: "all measured acceptance viewports pass; retain as a reviewed cascade difference",
    }))} : {}),
    reference: reference
      ? {
          url: reference.reference_url ?? reference.url ?? null,
          reference_selector_count: reference.reference_selector_count ?? null,
          missing: reference.diagnosis?.missing_count ?? 0,
          collapsed: reference.diagnosis?.collapsed_count ?? 0,
          expanded: reference.diagnosis?.expanded_count ?? 0,
        }
      : null,
    torture: torture
      ? {
          verdict: torture.verdict,
          issue_count: torture.issue_count ?? (torture.issues?.length ?? 0),
          changed_component_count: torture.changed_component_count ?? 0,
        }
      : null,
    viewport_status: viewportStatus,
    font_diagnostics: fontDiagnostics,
    interaction_diagnostics: interactionDiagnostics,
    image_diagnostics: imageDiagnostics,
    page_image_assets: pageImageAssets,
    visual: summarizeVisual(visual),
    assets,
    artifacts,
  };
}

export function expandVerdict(verdict, full) {
  return {
    ...verdict,
    top_issues: full?.issues ?? verdict.top_issues,
    selector_rows: full?.selector_rows ?? undefined,
    computed_style_rows: full?.computed_style_rows ?? undefined,
    viewport_diagnostics: full?.viewports ?? undefined,
    torture_full: full?.torture ?? undefined,
  };
}
