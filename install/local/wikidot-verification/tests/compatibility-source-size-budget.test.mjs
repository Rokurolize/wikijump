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
  [
    "install/local/wikidot-verification/src/listpages-preview-classification.mjs",
    2_300,
  ],
  ["deepwell/src/services/render/runtime_modules.rs", 1_900],
  ["deepwell/src/services/render/list_pages/scanner.rs", 2_700],
  ["deepwell/src/services/render/list_pages/rendering.rs", 300],
  ["deepwell/src/services/render/list_pages/substitution.rs", 2_700],
  ["deepwell/src/services/render/list_pages/delayed.rs", 1_600],
  ["deepwell/src/services/page_query/service.rs", 2_500],
  ["deepwell/src/endpoints/page.rs", 1_600],
  ["framerail/src/lib/server/ajax-module-connector.js", 1_500],
  ["deepwell/src/services/render/service.rs", 4_000],
]);

const SPLIT_RUNTIME_MODULE_BUDGET = 700;
const SPLIT_RENDER_SERVICE_BUDGET = 1_000;
const SPLIT_LISTPAGES_SCANNER_BUDGET = 900;
const SPLIT_LISTPAGES_RENDERING_BUDGET = 1_500;
const SPLIT_LISTPAGES_SUBSTITUTION_BUDGET = 500;
const SPLIT_LISTPAGES_DELAYED_BUDGET = 700;
const SPLIT_PAGE_QUERY_SERVICE_BUDGET = 700;
const SPLIT_LISTPAGES_PREVIEW_CLASSIFICATION_BUDGET = 1_000;

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

test("split runtime-module implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/runtime_modules",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const relativePath = "deepwell/src/services/render/runtime_modules/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_RUNTIME_MODULE_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split render-service implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/service",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs") && name !== "tests.rs")
    .map((name) => {
      const relativePath = "deepwell/src/services/render/service/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_RENDER_SERVICE_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split ListPages scanner implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/list_pages/scanner",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        name.endsWith(".rs") &&
        !name.endsWith("_tests.rs") &&
        name !== "tests.rs",
    )
    .map((name) => {
      const relativePath =
        "deepwell/src/services/render/list_pages/scanner/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_LISTPAGES_SCANNER_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split ListPages rendering implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/list_pages/rendering",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const relativePath =
        "deepwell/src/services/render/list_pages/rendering/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_LISTPAGES_RENDERING_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split ListPages substitution implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/list_pages/substitution",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const relativePath =
        "deepwell/src/services/render/list_pages/substitution/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_LISTPAGES_SUBSTITUTION_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split ListPages delayed implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/render/list_pages/delayed",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const relativePath =
        "deepwell/src/services/render/list_pages/delayed/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_LISTPAGES_DELAYED_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split page-query service implementation files stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "deepwell/src/services/page_query/service",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".rs"))
    .map((name) => {
      const relativePath = "deepwell/src/services/page_query/service/" + name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(({ actual }) => actual > SPLIT_PAGE_QUERY_SERVICE_BUDGET)
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});

test("split ListPages preview-classification helpers stay bounded", () => {
  const directory = path.join(
    REPOSITORY_ROOT,
    "install/local/wikidot-verification/src/listpages-preview-classification",
  );
  const offenders = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => {
      const relativePath =
        "install/local/wikidot-verification/src/listpages-preview-classification/" +
        name;
      return {
        file: relativePath,
        actual: lineCount(relativePath),
      };
    })
    .filter(
      ({ actual }) =>
        actual > SPLIT_LISTPAGES_PREVIEW_CLASSIFICATION_BUDGET,
    )
    .sort((left, right) => right.actual - left.actual);
  assert.deepEqual(offenders, []);
});
