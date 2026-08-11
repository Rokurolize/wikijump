import assert from "node:assert/strict";
import test from "node:test";

import { compareFirstDivergenceTraces } from "../src/first-divergent-element.mjs";

const rect = (overrides = {}) => ({
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  ...overrides,
});

const element = (tag, textFingerprint, overrides = {}) => ({
  path: `${tag}[1]`,
  tag,
  id: null,
  classes: [],
  direct_text_sha256: textFingerprint,
  rect: rect(),
  style: {
    display: "block",
    "font-family": "Arial",
    "font-size": "16px",
    "line-height": "20px",
  },
  ...overrides,
});

const trace = (elements, overrides = {}) => ({
  root_selector: "#page-content",
  element_count: elements.length,
  captured_count: elements.length,
  truncated: false,
  incomplete_image_count: 0,
  elements,
  ...overrides,
});

test("identical ordered traces report no first divergence", () => {
  const value = trace([element("p", "one"), element("span", "two")]);
  assert.deepEqual(compareFirstDivergenceTraces(value, value), {
    kind: "none",
    local_index: 2,
    live_index: 2,
    previous_stable_anchor: value.elements[1],
  });
});

test("a missing first paragraph reports the next generic stable anchor", () => {
  const heading = element("h1", "heading", { path: "h1[1]" });
  const paragraph = element("p", "first", { path: "p[1]" });
  const result = compareFirstDivergenceTraces(
    trace([heading]),
    trace([paragraph, heading]),
  );
  assert.equal(result.kind, "missing_local_element");
  assert.equal(result.local_index, 0);
  assert.equal(result.live_index, 0);
  assert.equal(result.next_stable_anchor.local_index, 0);
  assert.equal(result.next_stable_anchor.live_index, 1);
});

test("an extra middle inline reports the nearest following sibling", () => {
  const before = element("p", "before", { path: "p[1]" });
  const extra = element("span", "extra", { path: "span[1]" });
  const after = element("p", "after", { path: "p[2]" });
  const result = compareFirstDivergenceTraces(
    trace([before, extra, after]),
    trace([before, after]),
  );
  assert.equal(result.kind, "extra_local_element");
  assert.equal(result.next_stable_anchor.local_index, 2);
  assert.equal(result.next_stable_anchor.live_index, 1);
});

test("a font-size-only difference is classified before geometry", () => {
  const local = element("p", "same", {
    style: { display: "block", "font-size": "18px" },
  });
  const live = element("p", "same", {
    style: { display: "block", "font-size": "16px" },
  });
  const result = compareFirstDivergenceTraces(trace([local]), trace([live]));
  assert.equal(result.kind, "style_divergence");
  assert.deepEqual(result.style_delta, {
    "font-size": { local: "18px", live: "16px" },
  });
});

test("incomplete images gate geometry classification", () => {
  const local = trace([element("img", "", { rect: rect({ y: 200 }) })], {
    incomplete_image_count: 1,
  });
  const live = trace([element("img", "", { rect: rect({ y: 20 }) })]);
  const result = compareFirstDivergenceTraces(local, live);
  assert.equal(result.kind, "resource_incomplete");
  assert.deepEqual(result.incomplete_image_count, { local: 1, live: 0 });
});

test("same-name nodes use content fingerprints rather than tag names", () => {
  const first = element("div", "first", { path: "div[1]" });
  const inserted = element("div", "inserted", { path: "div[2]" });
  const second = element("div", "second", { path: "div[3]" });
  const result = compareFirstDivergenceTraces(
    trace([first, inserted, second]),
    trace([first, { ...second, path: "div[2]" }]),
  );
  assert.equal(result.kind, "extra_local_element");
  assert.equal(result.next_stable_anchor.local_index, 2);
  assert.equal(result.next_stable_anchor.live_index, 1);
});

test("known volatile tabview identities do not conceal later geometry", () => {
  const local = element("div", "same", {
    id: "wiki-tabview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const live = element("div", "same", {
    id: "wiki-tabview-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(
    compareFirstDivergenceTraces(trace([local]), trace([live])).kind,
    "none",
  );
});
