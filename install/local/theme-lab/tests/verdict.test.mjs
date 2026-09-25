import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerdict,
  expandVerdict,
  issuesFromSelectorDiagnosis,
  issuesFromPreview,
  issuesFromTorture,
  issuesFromViewports,
  nextActions,
  styleChangesFromComputed,
} from "../src/verdict.mjs";

test("selector diagnosis maps to ranked issues", () => {
  const issues = issuesFromSelectorDiagnosis({
    missing: [{selector: "#a", reference: 1, candidate: 0}],
    collapsed: [{selector: "#b", reference: 4, candidate: 1}],
    expanded: [{selector: "#c", reference: 1, candidate: 5}],
  });
  assert.deepEqual(
    issues.map((issue) => issue.kind),
    ["missing_selector", "collapsed_selector", "expanded_selector"],
  );
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[2].severity, "warn");
});

test("torture and viewport issues map", () => {
  const rating = issuesFromTorture({issues: [{severity: "error", kind: "new_viewport_overflow", component: "rating", viewport: "mobile", before_px: 0, after_px: 4.3, element_rect: {right: 394.3}, computed: {overflowX: "visible"}}]})[0];
  assert.equal(rating.element_rect.right, 394.3);
  assert.equal(rating.computed.overflowX, "visible");
  assert.equal(
    issuesFromTorture({issues: [{severity: "error", kind: "became_invisible", component: "table", viewport: "mobile"}]})[0]
      .kind,
    "became_invisible",
  );
  assert.equal(issuesFromViewports({mobile: {document_overflow_px: 83}})[0].kind, "viewport_overflow");
  assert.equal(issuesFromViewports({mobile: {document_overflow_px: 2}})[0].severity, "error");
  assert.equal(issuesFromViewports({mobile: {document_overflow_px: 0}}).length, 0);
  const overflow = issuesFromViewports({mobile: {document_overflow_px: 83, overflow_sources: [{selector: ".hero", overflow_px: 83}]}})[0];
  assert.equal(overflow.overflow_sources[0].selector, ".hero");
  assert.equal(nextActions([overflow])[0].overflow_sources[0].selector, ".hero");
});

test("unresolved Wikidot includes become actionable preview errors", () => {
  const preview = {
    unresolved_includes: [
      {page: "component:theme-squares", message: 'Included page "component:theme-squares" does not exist (create it now)'},
    ],
  };
  const issues = issuesFromPreview(preview);
  assert.deepEqual(issues, [{
    severity: "error",
    kind: "unresolved_include",
    include: "component:theme-squares",
    evidence: 'Included page "component:theme-squares" does not exist (create it now)',
  }]);
  const verdict = buildVerdict({preview});
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.next_actions, [{
    kind: "resolve_candidate_include",
    include: "component:theme-squares",
    evidence: {preview_error: issues[0].evidence},
  }]);
});

test("style changes are truncated", () => {
  const rows = Array.from({length: 5}, (_, index) => ({anchor: `a${index}`, property: "width"}));
  assert.equal(styleChangesFromComputed({top: rows}, 2).length, 2);
});

test("next actions carry selector, overflow, asset, and inactive media evidence", () => {
  const actions = nextActions(
    [
      {kind: "missing_selector", selector: ".foreign-rate", reference: 1, candidate: 0, suggested_candidate: {selector: ".page-rate-widget-box", confidence: 0.9}},
      {kind: "new_component_overflow", component: "tabview", viewport: "mobile", before_px: 0, after_px: 43},
      {kind: "candidate_asset_missing", asset: "logo.png"},
    ],
    [
      {anchor: "#header h1 a", property: "font-family", reference: "serif", candidate: "sans-serif", cascade: {winner: {selector: "#header h1 a", value: "sans-serif"}}},
      {anchor: "#main-content", property: "width", reference: "900px", candidate: "600px", cascade: {winner: {selector: "#main-content", value: "600px"}, media_inactive: [{media: "(min-width: 900px)", selector: "#main-content"}]}},
    ],
  );
  assert.deepEqual(actions.map((action) => action.kind), ["rewrite_selector", "reduce_overflow", "provide_asset", "inspect_inactive_media"]);
  assert.equal(actions[0].evidence.reference_count, 1);
  assert.equal(actions[1].evidence.after_px, 43);
  assert.equal(actions[3].evidence.winner.selector, "#main-content");
  assert.equal(actions[3].evidence.media_inactive[0].media, "(min-width: 900px)");
});

test("inactive-media leads resolve after every measured viewport passes", () => {
  const verdict = buildVerdict({
    reference: {
      diagnosis: {missing: [], collapsed: [], expanded: [], missing_count: 0},
      computed_styles: {top: [{
        anchor: "#main-content",
        property: "margin-left",
        reference: "184px",
        candidate: "17rem",
        cascade: {
          winner: {selector: "#main-content", value: "17rem"},
          media_inactive: [{condition: "(max-width: 767px)", selector: "#main-content", value: "5%"}],
        },
      }]},
    },
    viewports: {desktop: {document_overflow_px: 0}, laptop: {document_overflow_px: 0}, tablet: {document_overflow_px: 0}, mobile: {document_overflow_px: 0}},
  });
  assert.equal(verdict.next_actions.length, 0);
  assert.equal(verdict.resolved_actions[0].kind, "inspect_inactive_media");
  assert.equal(verdict.resolved_actions[0].resolution.includes("all measured acceptance viewports pass"), true);
});

test("buildVerdict fails on error, warns on style-only change, passes clean", () => {
  const fail = buildVerdict({
    reference: {diagnosis: {missing: [{selector: "#a", reference: 1, candidate: 0}], missing_count: 1}},
  });
  assert.equal(fail.verdict, "fail");
  assert.equal(fail.issue_count, 1);

  const warn = buildVerdict({
    reference: {diagnosis: {missing: [], collapsed: [], expanded: [], missing_count: 0}, computed_styles: {top: [{anchor: "a", property: "width"}]}},
  });
  assert.equal(warn.verdict, "warn");
  assert.equal(warn.style_changes.length, 1);

  const pass = buildVerdict({reference: {diagnosis: {missing: [], collapsed: [], expanded: [], missing_count: 0}}});
  assert.equal(pass.verdict, "pass");

  const tortureChange = buildVerdict({torture: {verdict: "pass", changed_component_count: 3, issues: []}});
  assert.equal(tortureChange.verdict, "warn");
});

test("buildVerdict surfaces torture and reference summaries", () => {
  const verdict = buildVerdict({
    reference: {url: "https://ref/", reference_selector_count: 10, diagnosis: {missing: [], collapsed: [], expanded: [], missing_count: 0, collapsed_count: 0, expanded_count: 0}},
    torture: {verdict: "fail", issue_count: 2, changed_component_count: 1, issues: []},
  });
  assert.equal(verdict.reference.reference_selector_count, 10);
  assert.equal(verdict.torture.verdict, "fail");
});

test("compact verdict retains each viewport's overflow status", () => {
  const verdict = buildVerdict({viewports: {
    desktop: {document_overflow_px: 0},
    laptop: {document_overflow_px: 0},
    tablet: {document_overflow_px: 1},
    mobile: {document_overflow_px: 0},
  }});
  assert.deepEqual(verdict.viewport_status, {
    desktop: {status: "pass", document_overflow_px: 0},
    laptop: {status: "pass", document_overflow_px: 0},
    tablet: {status: "fail", document_overflow_px: 1},
    mobile: {status: "pass", document_overflow_px: 0},
  });
});

test("interaction failures produce an evidence-backed repair action", () => {
  const verdict = buildVerdict({interactionDiagnostics: {
    tabs: {status: "pass", activated_index: 1, restored_index: 0},
    collapsible: {status: "fail", initial: "folded", after_click: "folded"},
  }});
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.next_actions, [{
    kind: "repair_interaction",
    interaction: "collapsible",
    evidence: {status: "fail", initial: "folded", after_click: "folded"},
  }]);
});

test("broken candidate page images fail with an asset-backed repair action", () => {
  const verdict = buildVerdict({imageDiagnostics: {
    status: "fail",
    image_count: 2,
    broken: [{src: "https://local.test/logo.png", alt: "SCP logo", selector: "img.logo", natural_width: 0, natural_height: 0}],
  }});
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.next_actions, [{
    kind: "localize_image",
    asset: "https://local.test/logo.png",
    selector: "img.logo",
    evidence: {alt: "SCP logo", natural_width: 0, natural_height: 0},
  }]);
  assert.equal(verdict.image_diagnostics.broken.length, 1);
});

test("expandVerdict restores full detail", () => {
  const compact = buildVerdict({});
  const expanded = expandVerdict(compact, {issues: [{kind: "x"}], selector_rows: [{selector: "a"}], viewports: {mobile: {overflow_sources: [{selector: ".x"}]}}});
  assert.equal(expanded.top_issues.length, 1);
  assert.deepEqual(expanded.selector_rows, [{selector: "a"}]);
  assert.equal(expanded.viewport_diagnostics.mobile.overflow_sources[0].selector, ".x");
});
