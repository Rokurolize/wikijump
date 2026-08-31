import assert from "node:assert/strict";
import test from "node:test";

import {dataFormSource} from "../scripts/capture-data-form-date-pagepath.mjs";

test("data-form cleanup has the expected source before save verification", () => {
  assert.equal(dataFormSource({date_value: "02/29/2024", origin: ""}), "date_value: 02/29/2024\norigin: ''");
  assert.equal(dataFormSource({date_value: "", origin: "tree:child"}), "date_value: \norigin: 'tree:child'");
  assert.equal(dataFormSource({date_value: "", origin: "tree:o'clock"}), "date_value: \norigin: 'tree:o''clock'");
});
