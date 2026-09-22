import assert from "node:assert/strict";
import test from "node:test";

import {comparePngRmse, parseImageMagickRmse} from "../src/visual-diff.mjs";
import {summarizeVisual} from "../src/verdict.mjs";

test("parseImageMagickRmse parses normalized values", () => {
  assert.deepEqual(parseImageMagickRmse("0.12 (0.00047)"), {absolute: 0.12, normalized: 0.00047});
  assert.throws(() => parseImageMagickRmse("nonsense"), /could not parse/u);
});

test("comparePngRmse passes under threshold and fails over it", async () => {
  const run = async () => ({stderr: "0.5 (0.001)"});
  const pass = await comparePngRmse("a.png", "b.png", {threshold: 0.015, run});
  assert.equal(pass.status, "pass");
  assert.equal(pass.normalized_rmse, 0.001);

  const fail = await comparePngRmse("a.png", "b.png", {threshold: 0.015, run: async () => ({stderr: "9.9 (0.9)"})});
  assert.equal(fail.status, "fail");
});

test("summarizeVisual reports per-viewport status", () => {
  const summary = summarizeVisual({
    desktop: {comparison: {status: "pass", normalized_rmse: 0.001}},
    mobile: {comparison: {status: "fail", normalized_rmse: 0.4}},
  });
  assert.equal(summary.status, "fail");
  assert.equal(summary.viewports.mobile.status, "fail");
  assert.equal(summarizeVisual(null), null);
});
