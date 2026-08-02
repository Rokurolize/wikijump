import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));

test("Wikidot specifications exclude user-submitted Community Site records", () => {
  const catalog = readJson("docs/wikidot-specifications/catalog.json");
  const coverage = readJson("docs/wikidot-specifications/source-coverage.json");

  assert.equal(catalog.corpus.page_count, coverage.page_count);
  assert.equal(
    coverage.listed_page_count + coverage.excluded_data_record_count,
    coverage.page_count,
  );
  assert.equal(
    coverage.classification_counts["structured-data-record"],
    coverage.excluded_data_record_count,
  );
  assert.deepEqual(coverage.excluded_data_groups.map((group) => group.path_prefix), [
    "community-sites:",
  ]);
  assert.ok(
    coverage.excluded_data_groups.every(
      (group) =>
        group.page_count > 0 &&
        group.source_bytes > 0 &&
        /^[a-f0-9]{64}$/.test(group.source_inventory_sha256),
    ),
  );
  assert.ok(
    coverage.pages.every(
      (page) => !page.fullname.startsWith("community-sites:"),
    ),
  );
  assert.ok(
    catalog.features.every((feature) =>
      feature.sources.every(
        (source) => !source.path.includes("/community-sites:"),
      ),
    ),
  );
});
