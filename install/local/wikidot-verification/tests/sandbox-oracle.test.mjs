import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  aggregateSandboxOracleVerdict,
  classifyBlockedResourceHosts,
  compareSandboxOracleFixture,
  SANDBOX_ORACLE_REGISTRY_SCHEMA,
  validateSandboxOracleCapture,
  validateSandboxOracleRegistry,
} from "../src/sandbox-oracle.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../");

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
    comparison_scope: "construct",
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

test("include target is captured before the page that includes it", () => {
  const registry = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "install/local/wikidot-verification/fixtures/sandbox-oracle-fixture-registry.json"),
    "utf8",
  ));
  const ids = registry.fixtures.map(({fixture_id}) => fixture_id);
  assert.ok(ids.indexOf("syntax-includes-target") < ids.indexOf("syntax-includes"));
});

test("page-chrome scope requires an explicit theme family", () => {
  assert.throws(
    () =>
      validateSandboxOracleRegistry({
        schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
        fixtures: [{...liveFixture(), comparison_scope: "page-chrome"}],
      }),
    /theme_family/u,
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

test("construct scope ignores page chrome while preserving construct findings", () => {
  const fixture = liveFixture();
  const local = capture({
    page_chrome_skeleton: {
      links: [{parent: "body", child: "#skrollr-body", parent_count: 1, child_count: 0, direct_child_count: 0}],
    },
    document: {
      presence_probes: [],
      custom_properties: {},
      resource_completion: {status: "complete"},
      page_content_rendered_images: 1,
      page_content_broken_images: [],
    },
  });
  const frozen = capture({
    input_url: "https://sandbox-for-codex.wikidot.com/fixture",
    final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    document: {
      presence_probes: [],
      custom_properties: {},
      resource_completion: {status: "complete"},
      page_content_rendered_images: 1,
      page_content_broken_images: [],
    },
  });
  const result = compareSandboxOracleFixture({
    fixture,
    local,
    frozen,
    contract: {
      geometry_selectors: [],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
      page_chrome_skeleton: {
        links: [{parent: "body", child: "#skrollr-body"}],
      },
    },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.comparison_scope, "construct");
  assert.equal(
    result.findings.some((finding) => finding.code === "page_chrome_skeleton_divergence"),
    false,
  );
});

test("construct scope excludes page-level geometry from the browser contract", () => {
  const fixture = liveFixture();
  const local = capture({
    document: {
      geometry: {
        "#page-content": {
          count: 1,
          rect: {x: 427, y: 260, width: 760, height: 720},
        },
      },
      presence_probes: [],
      custom_properties: {},
      resource_completion: {status: "complete"},
    },
  });
  const frozen = capture({
    input_url: "https://sandbox-for-codex.wikidot.com/fixture",
    final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    document: {
      geometry: {
        "#page-content": {
          count: 1,
          rect: {x: 113, y: 250, width: 847.5, height: 130},
        },
      },
      presence_probes: [],
      custom_properties: {},
      resource_completion: {status: "complete"},
    },
  });
  const result = compareSandboxOracleFixture({
    fixture,
    local,
    frozen,
    contract: {
      geometry_selectors: ["#page-content"],
      first_paint_geometry_selectors: [],
      presence_probes: [],
      first_paint_custom_properties: {},
      page_chrome_skeleton: null,
    },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.layers["structure-geometry"].status, "pass");
  assert.deepEqual(
    result.layers["structure-geometry"].detail.geometry,
    [],
  );
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
    allowed_blocked_hosts: {},
    blocked_hosts: {
      "ads.example.net": 1,
      "cdn.example.com": 2,
    },
    allowed_reason: "sealed-live-completion-policy-exact-external-script",
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

test("only an exact sealed script allowance can move a blocked host to the safety boundary", () => {
  const live = capture({
    input_url: "https://sandbox-for-codex.wikidot.com/fixture",
    final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    failures: [{
      kind: "request_failed",
      url: "https://cdn.example/advert.js",
      resource_type: "script",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
    }],
  });
  const policy = {
    schema: "wikijump.standing_browser_live_completion_policy.v1",
    status: "sealed",
    policy_version: "test-exact-script-v1",
    allowed_external_failures: [{
      kind: "request_failed",
      url: "https://cdn.example/advert.js",
      resource_type: "script",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
    }],
  };
  assert.deepEqual(
    classifyBlockedResourceHosts({
      blockedHosts: {"cdn.example": 1},
      live,
      policy,
    }),
    {
      allowed_blocked_hosts: {"cdn.example": 1},
      blocking_hosts: {},
    },
  );
  const result = compareSandboxOracleFixture({
    fixture: liveFixture(),
    local: capture(),
    frozen: live,
    allowedBlockedHosts: {"cdn.example": 1},
  });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.measurement_boundary, {
    blocked_hosts: {},
    allowed_blocked_hosts: {"cdn.example": 1},
    allowed_reason: "sealed-live-completion-policy-exact-external-script",
    finding_added: false,
  });
});

test("unlisted, mismatched, and non-script blocked resources remain blocking", () => {
  const live = capture({
    input_url: "https://sandbox-for-codex.wikidot.com/fixture",
    final_url: "https://sandbox-for-codex.wikidot.com/fixture",
    failures: [{
      kind: "request_failed",
      url: "https://cdn.example/advert.js",
      resource_type: "script",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
    }],
  });
  const policy = {
    schema: "wikijump.standing_browser_live_completion_policy.v1",
    status: "sealed",
    policy_version: "test-exact-script-v1",
    allowed_external_failures: [],
  };
  assert.deepEqual(
    classifyBlockedResourceHosts({blockedHosts: {"cdn.example": 1}, live, policy}),
    {allowed_blocked_hosts: {}, blocking_hosts: {"cdn.example": 1}},
  );
  assert.deepEqual(
    classifyBlockedResourceHosts({blockedHosts: {"cdn.example": 2}, live, policy: {
      ...policy,
      allowed_external_failures: [{
        kind: "request_failed",
        url: "https://cdn.example/advert.js",
        resource_type: "script",
        error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
      }],
    }}),
    {allowed_blocked_hosts: {}, blocking_hosts: {"cdn.example": 2}},
  );
  const imageLive = {
    ...live,
    failures: [{
      kind: "request_failed",
      url: "https://cdn.example/advert.png",
      resource_type: "image",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
    }],
  };
  assert.deepEqual(
    classifyBlockedResourceHosts({blockedHosts: {"cdn.example": 1}, live: imageLive, policy: {
      ...policy,
      allowed_external_failures: [{
        kind: "request_failed",
        url: "https://cdn.example/advert.png",
        resource_type: "image",
        error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
      }],
    }}),
    {allowed_blocked_hosts: {}, blocking_hosts: {"cdn.example": 1}},
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
