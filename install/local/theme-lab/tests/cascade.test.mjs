import assert from "node:assert/strict";
import test from "node:test";

import {cascadeDiagnosis, compareSpecificity, rankDeclarations, specificity} from "../src/cascade.mjs";

test("specificity counts ids, classes, and types", () => {
  assert.deepEqual(specificity("#a .b c"), [1, 1, 1]);
  assert.deepEqual(specificity(".a.b"), [0, 2, 0]);
  assert.deepEqual(specificity("a[href]::before"), [0, 1, 2]);
  assert.deepEqual(specificity("*"), [0, 0, 0]);
});

test("specificity honors :where and :is/:not", () => {
  assert.deepEqual(specificity(":where(#a) .b"), [0, 1, 0]);
  assert.deepEqual(specificity(":is(#a, .b)"), [1, 0, 0]);
  assert.deepEqual(specificity(":not(.a, #b) p"), [1, 0, 1]);
});

test("compareSpecificity orders lexicographically", () => {
  assert.ok(compareSpecificity([1, 0, 0], [0, 9, 9]) > 0);
  assert.equal(compareSpecificity([0, 1, 1], [0, 1, 1]), 0);
});

test("rankDeclarations puts important first, then specificity, then order", () => {
  const ranked = rankDeclarations([
    {selector: ".a", value: "1", important: false, order: 0},
    {selector: "#a", value: "2", important: false, order: 1},
    {selector: ".b", value: "3", important: true, order: 2},
  ]);
  assert.equal(ranked[0].selector, ".b");
  assert.equal(ranked[1].selector, "#a");
  assert.equal(ranked[2].selector, ".a");
});

test("cascadeDiagnosis reports the winner and overridden rules", () => {
  const diagnosis = cascadeDiagnosis({
    selector: "#header h1 a",
    property: "color",
    referenceValue: "rgb(187, 1, 17)",
    candidateValue: "rgb(0, 0, 0)",
    declarations: [
      {selector: "#header h1 a", value: "rgb(187, 1, 17)", important: false, order: 0},
      {selector: ".scp-jp-header a", value: "rgb(0, 0, 0)", important: true, order: 1},
    ],
    mediaInactive: [{condition: "(max-width: 600px)", selector: "#header h1 a", value: "red", important: false}],
    variables: {name: "--accent-color", value: "", defined: false},
  });
  assert.equal(diagnosis.status, "overridden");
  assert.equal(diagnosis.winner.selector, ".scp-jp-header a");
  assert.equal(diagnosis.winner.important, true);
  assert.equal(diagnosis.overridden[0].selector, "#header h1 a");
  assert.equal(diagnosis.media_inactive.length, 1);
  assert.equal(diagnosis.variables.defined, false);
});
