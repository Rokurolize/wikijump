import test from "node:test";
import assert from "node:assert/strict";
import {dedupeCssLayers} from "../src/css-layers.mjs";

test("CSS layer composition removes exact duplicates but keeps cascade order", () => {
  assert.deepEqual(
    dedupeCssLayers([".base{color:black}", ".theme{color:red}", ".base{color:black}", "  ", ".later{color:blue}" ]),
    [".base{color:black}", ".theme{color:red}", ".later{color:blue}"],
  );
});
