// Compact, agent-facing verdict construction.
//
// The raw browser/selector/torture data is large. An LLM wants a small ranked
// list of "what broke and where" plus a short list of style changes, and only
// asks for raw detail explicitly.

export const DEFAULT_LIMITS = Object.freeze({
  topIssues: 20,
  styleChanges: 20,
  selectorRows: 30,
});

function severityRank(severity) {
  return {error: 0, warn: 1, info: 2}[severity] ?? 3;
}

export function issuesFromSelectorDiagnosis(diagnosis) {
  const issues = [];
  for (const row of diagnosis?.missing ?? []) {
    issues.push({
      severity: "error",
      kind: "missing_selector",
      selector: row.selector,
      reference: row.reference,
      candidate: row.candidate,
      at_context: row.at_context ?? [],
    });
  }
  for (const row of diagnosis?.collapsed ?? []) {
    issues.push({
      severity: "error",
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
  }));
}

export function issuesFromViewports(viewports) {
  const issues = [];
  for (const [id, viewport] of Object.entries(viewports ?? {})) {
    const overflow = viewport?.document_overflow_px ?? 0;
    if (overflow > 2) {
      issues.push({severity: "error", kind: "viewport_overflow", viewport: id, overflow_px: overflow});
    }
  }
  return issues;
}

export function styleChangesFromComputed(computedStyles, limit = DEFAULT_LIMITS.styleChanges) {
  return (computedStyles?.top ?? []).slice(0, limit).map((row) => ({
    anchor: row.anchor,
    property: row.property,
    reference: row.reference,
    candidate: row.candidate,
    delta: row.delta,
    status: row.status,
  }));
}

export function buildVerdict({
  reference = null,
  torture = null,
  viewports = null,
  visual = null,
  timing = {},
  artifacts = {},
  extraIssues = [],
  limits = DEFAULT_LIMITS,
} = {}) {
  const issues = [
    ...issuesFromSelectorDiagnosis(reference?.diagnosis),
    ...issuesFromTorture(torture),
    ...issuesFromViewports(viewports),
    ...extraIssues,
  ];
  issues.sort((left, right) => severityRank(left.severity) - severityRank(right.severity));

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarn = issues.some((issue) => issue.severity === "warn");
  const styleChanges = styleChangesFromComputed(reference?.computed_styles, limits.styleChanges);

  const verdict = hasError ? "fail" : hasWarn || styleChanges.length > 0 ? "warn" : "pass";

  return {
    verdict,
    timing_ms: timing,
    issue_count: issues.length,
    top_issues: issues.slice(0, limits.topIssues),
    style_changes: styleChanges,
    reference: reference
      ? {
          url: reference.url ?? null,
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
    visual: visual ?? null,
    artifacts,
  };
}

export function expandVerdict(verdict, full) {
  return {
    ...verdict,
    top_issues: full?.issues ?? verdict.top_issues,
    selector_rows: full?.selector_rows ?? undefined,
    computed_style_rows: full?.computed_style_rows ?? undefined,
    torture_full: full?.torture ?? undefined,
  };
}
