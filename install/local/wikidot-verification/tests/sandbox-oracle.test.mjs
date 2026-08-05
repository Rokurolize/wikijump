import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSandboxOracleVerdict,
  compareSandboxOracleFixture,
  SANDBOX_ORACLE_REGISTRY_SCHEMA,
  validateSandboxOracleCapture,
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
      screenshot: {sha256: HASH, full_page: false},
    },
    document: {
      presence_probes: [],
      custom_properties: {},
      resource_completion: {status: "complete"},
    },
    settled_viewport_screenshot: {sha256: HASH, full_page: false},
    screenshot: { sha256: HASH, full_page: true },
    ...overrides,
  };
}

test("capture validation fails closed on an incomplete browser observation", () => {
  assert.throws(
    () =>
      validateSandboxOracleCapture(
        capture({
          capture_error: {name: "TimeoutError", message: "page.goto"},
        }),
        "fixture live capture",
      ),
    /fixture live capture failed/u,
  );
  assert.throws(
    () =>
      validateSandboxOracleCapture(
        capture({screenshot: null}),
        "fixture local capture",
      ),
    /fixture local capture is missing screenshot/u,
  );
  const complete = capture();
  assert.equal(validateSandboxOracleCapture(complete, "complete capture"), complete);
  const bounded = capture({
    document: {
      presence_probes: [],
      custom_properties: {},
      resource_completion: {
        status: "bounded_domcontentloaded",
        load_timeout_ms: 120000,
        pending_image_urls: ["https://cdn.example/pending.png"],
      },
    },
  });
  assert.equal(validateSandboxOracleCapture(bounded, "bounded capture"), bounded);
});

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

test("blocked public resources prevent an otherwise matching fixture from passing silently", () => {
  const fixture = liveFixture();
  const result = compareSandboxOracleFixture({
    fixture,
    local: capture(),
    frozen: capture({
      input_url: "https://sandbox-for-codex.wikidot.com/fixture",
      final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    }),
    blockedHosts: {
      "cdn.example.com": 2,
      "ads.example.net": 1,
    },
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.measurement_boundary, {
    blocked_hosts: {
      "ads.example.net": 1,
      "cdn.example.com": 2,
    },
    finding_added: true,
  });
  assert.deepEqual(
    result.findings.find(
      (finding) => finding.code === "normalization_hides_difference",
    ),
    {
      layer: "structure-geometry",
      code: "normalization_hides_difference",
      detail: {
        reason: "public-origin-resource-blocked-before-request-gate",
        blocked_hosts: {
          "ads.example.net": 1,
          "cdn.example.com": 2,
        },
      },
    },
  );
});

test("blocked host counts are validated before they can affect a verdict", () => {
  assert.throws(
    () =>
      compareSandboxOracleFixture({
        fixture: liveFixture(),
        local: capture(),
        frozen: capture({
          input_url: "https://sandbox-for-codex.wikidot.com/fixture",
          final_url: "https://sandbox-for-codex.wikidot.com/fixture",
        }),
        blockedHosts: { "not a hostname": 1 },
      }),
    /invalid hostname/u,
  );
  assert.throws(
    () =>
      compareSandboxOracleFixture({
        fixture: liveFixture(),
        local: capture(),
        frozen: capture({
          input_url: "https://sandbox-for-codex.wikidot.com/fixture",
          final_url: "https://sandbox-for-codex.wikidot.com/fixture",
        }),
        blockedHosts: { "cdn.example.com": 0 },
      }),
    /positive safe integer/u,
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
