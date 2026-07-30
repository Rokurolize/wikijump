import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  validateWikidotImplementationLedger,
} from "../../../../scripts/lib/wikidot-implementation-ledger.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../..");
const rawCatalog = readFileSync(
  resolve(repositoryRoot, "docs/wikidot-specifications/catalog.json"),
  "utf8",
);
const catalog = JSON.parse(rawCatalog);
const liveObservations = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      "docs/wikidot-specifications/live-observations.json",
    ),
    "utf8",
  ),
);
const liveObservationIds = liveObservations.observations.map(
  (observation) => observation.id,
);
const canonicalLedger = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      "scripts/data/wikidot-implementation-ledger.json",
    ),
    "utf8",
  ),
);

function validate(ledger) {
  validateWikidotImplementationLedger({
    ledger,
    rawCatalog,
    catalog,
    liveObservationIds,
    repositoryRoot,
  });
}

test("canonical compatibility ledger has a valid campaign property matrix", () => {
  assert.doesNotThrow(() => validate(canonicalLedger));
});

test("campaign scope cannot omit its P1-P8 matrix", () => {
  const ledger = structuredClone(canonicalLedger);
  delete ledger.feature_property_matrix["module-listpages"];

  assert.throws(
    () => validate(ledger),
    /campaign feature module-listpages has no P1-P8 property matrix/,
  );
});

test("implemented features cannot terminate on documentation-only evidence", () => {
  const ledger = structuredClone(canonicalLedger);
  ledger.features["module-listpages"].status = "implemented";
  ledger.features[
    "module-listpages"
  ].unresolved_ambiguities_or_blockers = [];
  ledger.feature_property_matrix["module-listpages"].P8 = {
    status: "documentation_only",
    evidence: [
      "docs:docs/wikidot-specifications/specifications/module/module-listpages.md",
    ],
    observation_gaps: ["Runtime-bound behavior has not been observed."],
  };

  assert.throws(
    () => validate(ledger),
    /Implemented feature module-listpages has non-terminal property P8: documentation_only/,
  );
});

test("ListPages cannot terminate while live P8 limits remain unobserved", () => {
  const ledger = structuredClone(canonicalLedger);
  ledger.features["module-listpages"].status = "implemented";
  ledger.features[
    "module-listpages"
  ].unresolved_ambiguities_or_blockers = [];

  assert.throws(
    () => validate(ledger),
    /Implemented feature module-listpages has non-terminal property P8: unobserved/,
  );
});

test("evidence-backed properties require known live evidence and a public regression seam", () => {
  const withoutLiveEvidence = structuredClone(canonicalLedger);
  withoutLiveEvidence.feature_property_matrix["module-listpages"].P1.evidence =
    [
      "test:deepwell/tests/page.rs#listpages_reverse_boolean_coercion_matches_live_wikidot",
    ];
  assert.throws(
    () => validate(withoutLiveEvidence),
    /Evidence-backed property module-listpages.P1 has no live-Wikidot evidence/,
  );

  const unknownLiveEvidence = structuredClone(canonicalLedger);
  unknownLiveEvidence.feature_property_matrix[
    "module-listpages"
  ].P1.evidence = [
    "live:not-a-real-observation",
    "test:deepwell/tests/page.rs#listpages_reverse_boolean_coercion_matches_live_wikidot",
  ];
  assert.throws(
    () => validate(unknownLiveEvidence),
    /references unknown live observation not-a-real-observation/,
  );

  const withoutRegression = structuredClone(canonicalLedger);
  withoutRegression.feature_property_matrix[
    "module-listpages"
  ].P1.evidence = ["live:listpages-invalid-numeric-fallbacks"];
  assert.throws(
    () => validate(withoutRegression),
    /Evidence-backed property module-listpages.P1 has no public regression seam/,
  );
});

test("test evidence rejects fabricated paths, non-public roots, and missing anchors", () => {
  const fabricatedPath = structuredClone(canonicalLedger);
  fabricatedPath.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:deepwell/tests/not-a-real-test.rs#fabricated_test",
  ];
  assert.throws(
    () => validate(fabricatedPath),
    /path does not exist: deepwell\/tests\/not-a-real-test\.rs/,
  );

  const internalOnly = structuredClone(canonicalLedger);
  internalOnly.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:deepwell/src/services/render/list_pages/scanner/tests.rs#parses_list_pages",
  ];
  assert.throws(
    () => validate(internalOnly),
    /is not under a public regression test root/,
  );

  const missingAnchor = structuredClone(canonicalLedger);
  missingAnchor.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:deepwell/tests/page.rs#not_a_real_listpages_regression",
  ];
  assert.throws(
    () => validate(missingAnchor),
    /anchor is not a declared runnable test in deepwell\/tests\/page\.rs/,
  );

  const genericSubstring = structuredClone(canonicalLedger);
  genericSubstring.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:deepwell/tests/page.rs#test",
  ];
  assert.throws(
    () => validate(genericSubstring),
    /anchor is not a declared runnable test in deepwell\/tests\/page\.rs: test/,
  );

  const fixtureFile = structuredClone(canonicalLedger);
  fixtureFile.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:framerail/tests/xmlrpc-deepwell-fixture/context.js#pageReadRequests",
  ];
  assert.throws(
    () => validate(fixtureFile),
    /path is not a supported public test file/,
  );

  const unanchored = structuredClone(canonicalLedger);
  unanchored.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    "test:deepwell/tests/page.rs",
  ];
  assert.throws(
    () => validate(unanchored),
    /must name an exact test anchor/,
  );
});

test("only executing JavaScript and Rust test declarations count as public seams", () => {
  const javascriptFixture =
    "install/local/wikidot-verification/tests/fixtures/implementation-ledger-disabled-evidence.test.mjs";
  for (const anchor of [
    "skipped JavaScript seam",
    "todo JavaScript seam",
    "only JavaScript seam",
    "callback-free JavaScript seam",
    "comment-only JavaScript seam",
    "string-only JavaScript seam",
  ]) {
    const ledger = structuredClone(canonicalLedger);
    ledger.feature_property_matrix["module-listpages"].P1.evidence = [
      "live:listpages-invalid-numeric-fallbacks",
      `test:${javascriptFixture}#${anchor}`,
    ];
    assert.throws(
      () => validate(ledger),
      /anchor is not a declared runnable test/,
      anchor,
    );
  }

  const runnableJavaScript = structuredClone(canonicalLedger);
  runnableJavaScript.feature_property_matrix[
    "module-listpages"
  ].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    `test:${javascriptFixture}#runnable JavaScript seam`,
  ];
  assert.doesNotThrow(() => validate(runnableJavaScript));

  const rustFixture =
    "install/local/wikidot-verification/tests/fixtures/implementation-ledger-disabled-evidence.rs";
  for (const anchor of [
    "ignored_rust_seam",
    "ignored_before_test_rust_seam",
    "cfg_before_test_rust_seam",
    "cfg_after_test_rust_seam",
    "comment_only_rust_seam",
    "string_only_rust_seam",
  ]) {
    const ledger = structuredClone(canonicalLedger);
    ledger.feature_property_matrix["module-listpages"].P1.evidence = [
      "live:listpages-invalid-numeric-fallbacks",
      `test:${rustFixture}#${anchor}`,
    ];
    assert.throws(
      () => validate(ledger),
      /anchor is not a declared runnable test/,
      anchor,
    );
  }

  const runnableRust = structuredClone(canonicalLedger);
  runnableRust.feature_property_matrix["module-listpages"].P1.evidence = [
    "live:listpages-invalid-numeric-fallbacks",
    `test:${rustFixture}#runnable_rust_seam`,
  ];
  assert.doesNotThrow(() => validate(runnableRust));
});

test("terminal rationales and required observation gaps cannot be whitespace", () => {
  const vacuousRationale = structuredClone(canonicalLedger);
  vacuousRationale.feature_property_matrix["module-listpages"].P8 = {
    status: "not_applicable",
    evidence: [],
    observation_gaps: [],
    rationale: " ",
  };
  assert.throws(
    () => validate(vacuousRationale),
    /Not-applicable property module-listpages.P8 has no rationale/,
  );

  const vacuousGap = structuredClone(canonicalLedger);
  vacuousGap.feature_property_matrix[
    "module-listpages"
  ].P8.observation_gaps = [" "];
  assert.throws(
    () => validate(vacuousGap),
    /must contain non-empty, trimmed strings/,
  );
});
