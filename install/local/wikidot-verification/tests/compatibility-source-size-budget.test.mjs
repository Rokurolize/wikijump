import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

const LINE_BUDGETS = new Map([
  [
    "install/local/wikidot-verification/scripts/build-compatibility-surface-inventory.mjs",
    3_000,
  ],
  ["deepwell/src/services/render/runtime_modules.rs", 2_800],
  ["deepwell/src/endpoints/page.rs", 1_600],
  ["deepwell/src/services/render/service.rs", 4_800],
]);

function lineCount(relativePath) {
  const text = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
  return text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
}

test("compatibility-sensitive production entrypoints stay within their source-size budgets", () => {
  const offenders = [];
  for (const [relativePath, maximum] of LINE_BUDGETS) {
    const actual = lineCount(relativePath);
    if (actual > maximum) {
      offenders.push({ file: relativePath, actual, maximum });
    }
  }
  assert.deepEqual(offenders, []);
});
