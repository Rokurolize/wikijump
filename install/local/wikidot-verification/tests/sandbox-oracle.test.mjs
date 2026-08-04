import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSandboxOracleVerdict,
  compareSandboxOracleFixture,
  SANDBOX_ORACLE_REGISTRY_SCHEMA,
  validateSandboxOracleRegistry,
} from "../src/sandbox-oracle.mjs";

const HASH = "a".repeat(64);

function provenance() {
  return {
    datestamp: "sandbox-oracle-20260805",
    content_sha256: HASH,
  };
}

function signature() {
  return {
    tags: { div: 1 },
    classes: { "fixture-body": 1 },
    attrs: { class: 1 },
    id_count: 0,
    comment_count: 0,
  };
}

function skeleton() {
  return {
    links: [
      { parent: "body", child: "#skrollr-body", parent_count: 1, child_count: 1, direct_child_count: 1 },
    ],
  };
}

function capture(overrides = {}) {
  return {
    input_url: "https://sandbox-for-codex.wikijump.localhost/fixture",
    final_url: "https://sandbox-for-codex.wikijump.localhost/fixture",
    navigation_status: 200,
    failures: [],
    geometry: {},
    rendered_images: 0,
    broken_images: [],
    dom_signatures: ["div.fixture-body"],
    dom_signature: signature(),
    attribute_signatures: [],
    page_chrome_skeleton: skeleton(),
    first_paint: {
      document: {
        geometry: {},
        presence_probes: [],
        custom_properties: {},
      },
    },
    document: { presence_probes: [], custom_properties: {} },
    screenshot: { sha256: HASH, full_page: true },
    ...overrides,
  };
}

function liveFixture() {
  return {
    fixture_id: "syntax-inline-bold",
    construct_family: "inline-formatting",
    guards: ["ftml-266"],
    owner: "FTML",
    assertion_class: "match-live",
    theme_family: null,
    provenance: provenance(),
  };
}

test("registry rejects delayed constructs assigned to the live assertion", () => {
  assert.throws(
    () =>
      validateSandboxOracleRegistry({
        schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
        fixtures: [
          {
            ...liveFixture(),
            fixture_id: "delayed-listpages",
            construct_family: "ListPages",
          },
        ],
      }),
    /match-frozen-preserved/u,
  );
});

test("registry requires an expected preserved shape for delayed fixtures", () => {
  const fixture = {
    ...liveFixture(),
    fixture_id: "delayed-listpages",
    construct_family: "ListPages",
    assertion_class: "match-frozen-preserved",
  };
  assert.throws(
    () =>
      validateSandboxOracleRegistry({
        schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
        fixtures: [fixture],
      }),
    /expected_preserved/u,
  );
  const registry = validateSandboxOracleRegistry({
    schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
    fixtures: [
      {
        ...fixture,
        expected_preserved: { dom_signature: signature() },
      },
    ],
  });
  assert.equal(registry.fixtures[0].assertion_class, "match-frozen-preserved");
});

test("match-live compares the frozen capture corner to corner", () => {
  const fixture = liveFixture();
  const result = compareSandboxOracleFixture({
    fixture,
    local: capture(),
    frozen: capture({
      input_url: "https://sandbox-for-codex.wikidot.com/fixture",
      final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    }),
    contract: {
      geometry_selectors: [],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
      page_chrome_skeleton: {
        links: [{ parent: "body", child: "#skrollr-body" }],
      },
    },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.layers["dom-signature"].status, "pass");
  assert.equal(result.layers["screenshot-receipt"].status, "pass");
});

test("normalization remains a blocking finding in the sandbox gate", () => {
  const result = compareSandboxOracleFixture({
    fixture: liveFixture(),
    local: capture({
      attribute_signatures: [
        { tag: "form", name: "data-page-id", value: "123" },
      ],
    }),
    frozen: capture({
      input_url: "https://sandbox-for-codex.wikidot.com/fixture",
      final_url: "https://sandbox-for-codex.wikidot.com/fixture",
      attribute_signatures: [
        { tag: "form", name: "data-page-id", value: "456" },
      ],
    }),
  });
  assert.equal(result.status, "fail");
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "normalization_hides_difference",
    ),
  );
});

test("preserved fixtures compare against the declared local shape", () => {
  const fixture = {
    ...liveFixture(),
    fixture_id: "delayed-listpages",
    construct_family: "ListPages",
    assertion_class: "match-frozen-preserved",
    expected_preserved: { dom_signature: signature() },
  };
  const result = compareSandboxOracleFixture({ fixture, local: capture() });
  assert.equal(result.status, "pass");
  assert.equal(
    result.layers["screenshot-receipt"].status,
    "not_applicable",
  );
});

test("aggregate requires complete registry coverage and reports failures", () => {
  const fixture = liveFixture();
  const registry = validateSandboxOracleRegistry({
    schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
    fixtures: [fixture],
  });
  const result = compareSandboxOracleFixture({
    fixture,
    local: capture({ dom_signature: { ...signature(), tags: { span: 1 } } }),
    frozen: capture({
      input_url: "https://sandbox-for-codex.wikidot.com/fixture",
      final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    }),
  });
  const aggregate = aggregateSandboxOracleVerdict({
    runId: "run-1",
    registry,
    results: [result],
  });
  assert.equal(aggregate.verdict.aggregate.fail, 1);
  assert.equal(aggregate.exitCode, 1);
});
