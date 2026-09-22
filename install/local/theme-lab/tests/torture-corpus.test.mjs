import assert from "node:assert/strict";
import test from "node:test";

import {diffTortureStates} from "../src/torture-corpus.mjs";

function component(overrides = {}) {
  return {
    expected_present: true,
    visible: true,
    expected_selector: ".expected",
    viewport_overflow_px: 0,
    own_overflow_px: 0,
    rect: {width: 100, height: 40},
    font_size_px: 16,
    line_height_px: 24,
    ...overrides,
  };
}

function state(componentValue = component(), page = {document_overflow_px: 0}) {
  return {
    desktop: {
      page,
      components: {table: componentValue},
    },
  };
}

test("torture diff passes unchanged state", () => {
  const baseline = state();
  const candidate = state();
  const diff = diffTortureStates(baseline, candidate);
  assert.equal(diff.verdict, "pass");
  assert.equal(diff.issue_count, 0);
  assert.deepEqual(diff.changes, []);
});

test("torture diff catches a structure disappearing", () => {
  const diff = diffTortureStates(
    state(),
    state(component({expected_present: false, visible: true})),
  );
  assert.equal(diff.verdict, "fail");
  assert.equal(diff.issues[0].kind, "expected_structure_missing");
});

test("torture diff rejects an invalid baseline fixture", () => {
  const diff = diffTortureStates(
    state(component({expected_present: false})),
    state(component({expected_present: false})),
  );
  assert.equal(diff.verdict, "fail");
  assert.equal(diff.issues[0].kind, "baseline_structure_missing");
});

test("torture diff catches newly hidden content", () => {
  const diff = diffTortureStates(state(), state(component({visible: false})));
  assert.equal(diff.verdict, "fail");
  assert.equal(diff.issues[0].kind, "became_invisible");
});

test("torture diff catches new horizontal overflow", () => {
  const diff = diffTortureStates(
    state(),
    state(component(), {document_overflow_px: 38}),
  );
  assert.equal(diff.verdict, "fail");
  assert.equal(diff.issues[0].kind, "new_horizontal_overflow");
});

test("torture diff catches new component overflow", () => {
  const diff = diffTortureStates(
    state(),
    state(component({own_overflow_px: 25})),
  );
  assert.equal(diff.verdict, "fail");
  assert.equal(diff.issues[0].kind, "new_component_overflow");
});

test("torture diff reports large geometry changes without calling them invalid", () => {
  const diff = diffTortureStates(
    state(),
    state(component({rect: {width: 150, height: 40}})),
  );
  assert.equal(diff.verdict, "pass");
  assert.equal(diff.changed_component_count, 1);
  assert.equal(diff.changes[0].property, "rect.width");
  assert.equal(diff.changes[0].relative, 0.5);
});
