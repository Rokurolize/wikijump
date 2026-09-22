import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerdict,
  expandVerdict,
  issuesFromSelectorDiagnosis,
  issuesFromTorture,
  issuesFromViewports,
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
  assert.equal(
    issuesFromTorture({issues: [{severity: "error", kind: "became_invisible", component: "table", viewport: "mobile"}]})[0]
      .kind,
    "became_invisible",
  );
  assert.equal(issuesFromViewports({mobile: {document_overflow_px: 83}})[0].kind, "viewport_overflow");
  assert.equal(issuesFromViewports({mobile: {document_overflow_px: 0}}).length, 0);
});

test("style changes are truncated", () => {
  const rows = Array.from({length: 5}, (_, index) => ({anchor: `a${index}`, property: "width"}));
  assert.equal(styleChangesFromComputed({top: rows}, 2).length, 2);
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
});

test("buildVerdict surfaces torture and reference summaries", () => {
  const verdict = buildVerdict({
    reference: {url: "https://ref/", reference_selector_count: 10, diagnosis: {missing: [], collapsed: [], expanded: [], missing_count: 0, collapsed_count: 0, expanded_count: 0}},
    torture: {verdict: "fail", issue_count: 2, changed_component_count: 1, issues: []},
  });
  assert.equal(verdict.reference.reference_selector_count, 10);
  assert.equal(verdict.torture.verdict, "fail");
});

test("expandVerdict restores full detail", () => {
  const compact = buildVerdict({});
  const expanded = expandVerdict(compact, {issues: [{kind: "x"}], selector_rows: [{selector: "a"}]});
  assert.equal(expanded.top_issues.length, 1);
  assert.deepEqual(expanded.selector_rows, [{selector: "a"}]);
});
