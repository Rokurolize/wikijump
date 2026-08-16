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

test("the 57 current source-gap specifications have exact detailed P1-P8 coverage", () => {
  const catalog = readJson("docs/wikidot-specifications/catalog.json");
  const contracts = readJson(
    "docs/wikidot-specifications/detailed-feature-contracts.json",
  );
  const evidence = readJson(
    "docs/wikidot-specifications/detailed-spec-evidence-20260816.json",
  );
  const expectedAxes = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];

  assert.equal(contracts.schema, "wikijump.wikidot_detailed_feature_contracts.v1");
  assert.deepEqual(contracts.source_gap_snapshot, {
    wikijump_commit: "257f6a3936976f1a6ea5094ae0cee5ac12777495",
    canonical_surface_count: 870,
    feature_count: 57,
  });
  const featureIds = Object.keys(contracts.features);
  assert.equal(featureIds.length, 57);
  assert.equal(
    featureIds.reduce(
      (count, featureId) => count + Object.keys(contracts.features[featureId].axes).length,
      0,
    ),
    456,
  );

  const catalogById = new Map(catalog.features.map((feature) => [feature.id, feature]));
  for (const featureId of featureIds) {
    const feature = catalogById.get(featureId);
    assert.ok(feature, `missing catalog feature ${featureId}`);
    const contract = contracts.features[featureId];
    assert.deepEqual(Object.keys(contract.axes), expectedAxes, featureId);
    for (const axis of expectedAxes) {
      assert.ok(contract.axes[axis].length > 0, `${featureId} ${axis} is empty`);
    }

    const specification = readFileSync(
      resolve(repositoryRoot, "docs/wikidot-specifications", feature.specification),
      "utf8",
    );
    assert.match(
      specification,
      /- Detailed conformance status: `detailed-p1-p8`/u,
      featureId,
    );
    assert.match(specification, /## Detailed conformance contract/u, featureId);
    for (const [axis, title] of [
      ["P1", "invocation grammar and scalar interpretation"],
      ["P2", "parser stage, nesting, and composition"],
      ["P3", "lifecycle, persistence, import, and round trips"],
      ["P4", "actors, permissions, visibility, and privacy"],
      ["P5", "selection, ordering, counting, and pagination"],
      ["P6", "HTTP, API, URL, Ajax, feed, and navigation contracts"],
      ["P7", "DOM, CSS, resources, interaction, and geometry"],
      ["P8", "temporal behavior, failure atomicity, limits, and resource bounds"],
    ]) {
      assert.ok(
        specification.includes(`### ${axis} - ${title}`),
        `${featureId} is missing ${axis}`,
      );
    }
  }

  assert.equal(evidence.redaction.credentials_retained, false);
  assert.equal(evidence.redaction.session_material_retained, false);
  assert.equal(evidence.redaction.private_message_content_retained, false);
  assert.equal(evidence.redaction.authenticated_capture_credential_audit_passed, true);
});
