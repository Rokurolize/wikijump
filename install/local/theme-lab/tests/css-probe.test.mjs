import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSelectorTexts,
  diffComputedStyles,
  parseStyleSheet,
  rankSelectorDiffs,
  selectorDiagnosis,
  splitTopLevel,
  stripCssComments,
  summarizeComputedStyleDiffs,
} from "../src/css-probe.mjs";

test("stripCssComments removes comments without touching strings", () => {
  assert.equal(stripCssComments("a{color:red}/* x */b{}"), "a{color:red} b{}");
  assert.equal(stripCssComments('a{content:"/* not a comment */"}'), 'a{content:"/* not a comment */"}');
});

test("splitTopLevel ignores commas inside functions and strings", () => {
  assert.deepEqual(splitTopLevel("a, b:is(c, d), e", ","), ["a", " b:is(c, d)", " e"]);
  assert.deepEqual(splitTopLevel('a[href="x,y"], b', ","), ['a[href="x,y"]', " b"]);
});

test("parseStyleSheet extracts selectors and recurses into media queries", () => {
  const rules = parseStyleSheet(`
    /* header */
    #header, .site-header { color: red; }
    @media (max-width: 600px) {
      #header { display: none; }
    }
    @font-face { font-family: x; }
    #page-content > p:hover { margin: 0; }
  `);
  assert.deepEqual(
    rules.map((rule) => rule.selector),
    ["#header", ".site-header", "#header", "#page-content > p:hover"],
  );
  assert.equal(rules[2].atContext[0], "@media (max-width: 600px)");
});

test("collectSelectorTexts de-duplicates while preserving order", () => {
  assert.deepEqual(
    collectSelectorTexts([{selector: "a"}, {selector: "b"}, {selector: "a"}]),
    ["a", "b"],
  );
});

test("rankSelectorDiffs puts missing selectors first", () => {
  const rows = rankSelectorDiffs({
    referenceRules: [{selector: "#header"}, {selector: ".unused"}, {selector: "table"}],
    referenceCounts: {"#header": 1, ".unused": 3, table: 2},
    candidateCounts: {"#header": 1, ".unused": 0, table: 1},
  });
  assert.deepEqual(
    rows.map((row) => [row.selector, row.status]),
    [[".unused", "missing"], ["table", "count_changed"], ["#header", "match"]],
  );
});

test("selectorDiagnosis reports missing and collapsed rules", () => {
  const rows = rankSelectorDiffs({
    referenceRules: [{selector: "#a"}, {selector: "#b"}, {selector: "#c"}],
    referenceCounts: {"#a": 4, "#b": 3, "#c": 1},
    candidateCounts: {"#a": 0, "#b": 1, "#c": 1},
  });
  const diagnosis = selectorDiagnosis(rows);
  assert.equal(diagnosis.missing_count, 1);
  assert.equal(diagnosis.collapsed_count, 1);
  assert.equal(diagnosis.expanded_count, 0);
});

test("diffComputedStyles ranks numeric deltas and records geometry", () => {
  const rows = diffComputedStyles({
    reference: {anchor: {rect: {x: 0, y: 0, width: 100, height: 20}, style: {"font-size": "12.8px", color: "rgb(0, 0, 0)"}}},
    candidate: {anchor: {rect: {x: 0, y: 0, width: 132, height: 20}, style: {"font-size": "13.44px", color: "rgb(0, 0, 0)"}}},
    properties: ["font-size", "color"],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].property, "rect.width");
  assert.equal(rows[0].delta, 32);
  assert.equal(rows[1].property, "font-size");
  assert.equal(rows[1].status, "numeric_delta");
});

test("diffComputedStyles records a missing element", () => {
  const rows = diffComputedStyles({
    reference: {gone: {rect: {width: 1}, style: {}}},
    candidate: {},
    properties: ["display"],
  });
  assert.equal(rows[0].status, "element_presence");
});

test("summarizeComputedStyleDiffs groups by status and anchor", () => {
  const summary = summarizeComputedStyleDiffs([
    {anchor: "a", status: "numeric_delta", property: "width", delta: 4},
    {anchor: "a", status: "value_diff", property: "color", delta: null},
    {anchor: "b", status: "numeric_delta", property: "height", delta: 2},
  ]);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.by_status, {numeric_delta: 2, value_diff: 1});
  assert.deepEqual(summary.by_anchor, {a: 2, b: 1});
});
