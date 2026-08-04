import {
  compareAttributeSignatures,
  compareCaptures,
  compareGeometry,
  comparePageChromeSkeleton,
  DEFAULT_THRESHOLDS,
  evaluatePresenceProbes,
  multisetDistance,
  normalizeCssValue,
  validateThresholds,
} from "./standing-browser-parity-contract.mjs";
import { compareSignatures } from "./oracle-fixtures.mjs";
import {
  isPlainObject,
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

export const SANDBOX_ORACLE_REGISTRY_SCHEMA =
  "wikijump_local_lab.sandbox_oracle_fixture_registry.v1";
export const SANDBOX_ORACLE_VERDICT_SCHEMA =
  "wikijump_local_lab.sandbox_oracle_verdict.v1";
export const SANDBOX_ORACLE_ASSERTION_CLASSES = Object.freeze([
  "match-live",
  "match-frozen-preserved",
]);
export const SANDBOX_ORACLE_OWNERS = Object.freeze([
  "FTML",
  "Framerail/Deepwell",
]);
export const SANDBOX_ORACLE_LAYER_NAMES = Object.freeze([
  "dom-signature",
  "structure-geometry",
  "computed-style",
  "presence-pseudo-layout",
  "screenshot-receipt",
]);

// These families are delayed by design.  They must not be compared with the
// live page: Wikidot executes them while the local syntax layer preserves the
// delayed structure for Wikijump's runtime.
export const SANDBOX_ORACLE_DELAYED_FAMILIES = Object.freeze([
  "listpages",
  "countpages",
  "unknownmodule",
  "unknownmodules",
  "conditionalblock",
  "conditionalblocks",
]);

const OWNER_SET = new Set(SANDBOX_ORACLE_OWNERS);
const ASSERTION_SET = new Set(SANDBOX_ORACLE_ASSERTION_CLASSES);
const DELAYED_SET = new Set(SANDBOX_ORACLE_DELAYED_FAMILIES);

function normalizedFamily(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isDelayedFamily(value) {
  return DELAYED_SET.has(normalizedFamily(value));
}

function validateCountMap(value, name) {
  const object = requirePlainObject(value, name);
  for (const [key, count] of Object.entries(object)) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${name}.${key} must be a non-negative integer`);
    }
  }
  return { ...object };
}

function validateDomSignature(value, name) {
  const signature = requirePlainObject(value, name);
  return {
    tags: validateCountMap(signature.tags, `${name}.tags`),
    classes: validateCountMap(signature.classes, `${name}.classes`),
    attrs: validateCountMap(signature.attrs, `${name}.attrs`),
    id_count: validateCountMap(
      { value: signature.id_count },
      `${name}.id_count`,
    ).value,
    comment_count: validateCountMap(
      { value: signature.comment_count },
      `${name}.comment_count`,
    ).value,
  };
}

function validateProvenance(value, name) {
  const provenance = requirePlainObject(value, name);
  const datestamp = requireNonEmptyString(
    provenance.datestamp,
    `${name}.datestamp`,
  );
  if (!/^sandbox-oracle-\d{8}$/u.test(datestamp)) {
    throw new Error(
      `${name}.datestamp must use sandbox-oracle-YYYYMMDD`,
    );
  }
  return {
    datestamp,
    content_sha256: requireSha256(
      provenance.content_sha256,
      `${name}.content_sha256`,
    ),
  };
}

function validatePreservedExpectation(value, name) {
  const expected = requirePlainObject(value, name);
  const result = { ...expected };
  if (expected.dom_signature !== undefined) {
    result.dom_signature = validateDomSignature(
      expected.dom_signature,
      `${name}.dom_signature`,
    );
  } else {
    throw new Error(`${name}.dom_signature is required`);
  }
  if (expected.dom_signatures !== undefined) {
    if (
      !Array.isArray(expected.dom_signatures) ||
      expected.dom_signatures.some((value) => typeof value !== "string")
    ) {
      throw new Error(`${name}.dom_signatures must be an array of strings`);
    }
    result.dom_signatures = [...expected.dom_signatures].sort();
  }
  if (expected.attribute_signatures !== undefined) {
    if (
      !Array.isArray(expected.attribute_signatures) ||
      expected.attribute_signatures.some((value) => !isPlainObject(value))
    ) {
      throw new Error(
        `${name}.attribute_signatures must be an array of objects`,
      );
    }
    result.attribute_signatures = expected.attribute_signatures.map(
      (value) => ({
        tag: requireNonEmptyString(value.tag, `${name}.attribute_signatures.tag`),
        name: requireNonEmptyString(
          value.name,
          `${name}.attribute_signatures.name`,
        ),
        value: String(value.value ?? ""),
      }),
    );
  }
  return result;
}

export function validateSandboxOracleFixture(value, index = 0) {
  const entry = requirePlainObject(value, `fixtures[${index}]`);
  const fixtureId = requireNonEmptyString(
    entry.fixture_id,
    `fixtures[${index}].fixture_id`,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(fixtureId)) {
    throw new Error(`fixtures[${index}].fixture_id has unsupported characters`);
  }
  const constructFamily = requireNonEmptyString(
    entry.construct_family,
    `fixtures[${index}].construct_family`,
  );
  const guards = entry.guards;
  if (
    !Array.isArray(guards) ||
    guards.length === 0 ||
    guards.some((guard) => typeof guard !== "string" || guard.trim() === "")
  ) {
    throw new Error(
      `fixtures[${index}].guards must contain at least one non-empty string`,
    );
  }
  const owner = requireNonEmptyString(
    entry.owner,
    `fixtures[${index}].owner`,
  );
  if (!OWNER_SET.has(owner)) {
    throw new Error(`fixtures[${index}].owner is unsupported`);
  }
  const assertionClass = requireNonEmptyString(
    entry.assertion_class,
    `fixtures[${index}].assertion_class`,
  );
  if (!ASSERTION_SET.has(assertionClass)) {
    throw new Error(`fixtures[${index}].assertion_class is unsupported`);
  }
  if (assertionClass === "match-live" && isDelayedFamily(constructFamily)) {
    throw new Error(
      `fixtures[${index}] delayed construct families must use match-frozen-preserved`,
    );
  }
  const themeFamily = entry.theme_family ?? null;
  if (themeFamily !== null && typeof themeFamily !== "string") {
    throw new Error(`fixtures[${index}].theme_family must be a string or null`);
  }
  const result = {
    fixture_id: fixtureId,
    construct_family: constructFamily,
    guards: [...guards].sort(),
    owner,
    assertion_class: assertionClass,
    theme_family: themeFamily,
    provenance: validateProvenance(
      entry.provenance,
      `fixtures[${index}].provenance`,
    ),
  };
  if (assertionClass === "match-frozen-preserved") {
    result.expected_preserved = validatePreservedExpectation(
      entry.expected_preserved,
      `fixtures[${index}].expected_preserved`,
    );
  } else if (entry.expected_preserved !== undefined) {
    throw new Error(
      `fixtures[${index}].expected_preserved is only valid for match-frozen-preserved`,
    );
  }
  return Object.freeze(result);
}

export function validateSandboxOracleRegistry(value) {
  const registry = requirePlainObject(value, "sandbox oracle registry");
  if (registry.schema !== SANDBOX_ORACLE_REGISTRY_SCHEMA) {
    throw new Error(
      `sandbox oracle registry must use ${SANDBOX_ORACLE_REGISTRY_SCHEMA}`,
    );
  }
  if (!Array.isArray(registry.fixtures)) {
    throw new Error("sandbox oracle registry.fixtures must be an array");
  }
  const fixtures = registry.fixtures.map(validateSandboxOracleFixture);
  const fixtureIds = fixtures.map((fixture) => fixture.fixture_id);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error("sandbox oracle registry contains duplicate fixture_id");
  }
  return Object.freeze({
    schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
    ...(registry.registry_id ? { registry_id: String(registry.registry_id) } : {}),
    ...(registry.status ? { status: String(registry.status) } : {}),
    fixtures: Object.freeze(fixtures),
  });
}

function layer(status, findings = [], detail = null) {
  return {
    status,
    applicable: status !== "not_applicable",
    findings,
    ...(detail === null ? {} : { detail }),
  };
}

function exactDomLayer(local, target) {
  const localSignature = local?.dom_signature ?? local?.document?.dom_signature;
  const targetSignature = target?.dom_signature ?? target?.document?.dom_signature;
  if (!localSignature || !targetSignature) {
    return layer("fail", [
      {
        code: "dom_signature_missing",
        detail: {
          local: Boolean(localSignature),
          target: Boolean(targetSignature),
        },
      },
    ]);
  }
  const diffs = compareSignatures(targetSignature, localSignature);
  return layer(
    diffs.length === 0 ? "pass" : "fail",
    diffs.length === 0
      ? []
      : [{ code: "dom_signature_divergence", detail: { diffs } }],
    { target: targetSignature, local: localSignature, diffs },
  );
}

function screenshotLayer(local, target, required = true) {
  const localScreenshot = local?.screenshot ?? null;
  const targetScreenshot = target?.screenshot ?? null;
  if (!required) {
    return layer("not_applicable");
  }
  const localSha = localScreenshot?.sha256;
  const targetSha = targetScreenshot?.sha256;
  const localValid = typeof localSha === "string" && /^[0-9a-f]{64}$/u.test(localSha);
  const targetValid = typeof targetSha === "string" && /^[0-9a-f]{64}$/u.test(targetSha);
  if (!localValid || !targetValid) {
    return layer("fail", [
      {
        code: "screenshot_receipt_missing",
        detail: { local_sha256: localSha ?? null, target_sha256: targetSha ?? null },
      },
    ]);
  }
  return layer("pass", [], {
    local_sha256: localSha,
    target_sha256: targetSha,
    comparison: "receipt-only-no-pixel-diff",
  });
}

function classifyCaptureAnomalies(comparison) {
  const structure = [];
  const computed = [];
  const presence = [];
  for (const anomaly of comparison.anomalies ?? []) {
    const code = anomaly.code ?? "unknown";
    if (
      /custom_property|font|style/iu.test(code)
    ) {
      computed.push(anomaly);
    } else if (/probe|pseudo/iu.test(code)) {
      presence.push(anomaly);
    } else {
      structure.push(anomaly);
    }
  }
  return { structure, computed, presence };
}

function statusForFindings(findings) {
  return findings.length === 0 ? "pass" : "fail";
}

function preservedLayers(fixture, local, thresholds) {
  const expected = fixture.expected_preserved;
  const dom = exactDomLayer(local, expected);
  const structureFindings = [];
  const structureDetail = {};
  if (expected.dom_signatures !== undefined) {
    const distance = multisetDistance(
      local?.dom_signatures ?? [],
      expected.dom_signatures,
    );
    structureDetail.dom_multiset_distance = distance;
    if (distance.ratio > thresholds.dom_multiset_distance_ratio) {
      structureFindings.push({
        code: "dom_structure_divergence",
        detail: distance,
      });
    }
  }
  if (expected.geometry) {
    const selectors = Object.keys(expected.geometry).sort();
    const geometry = compareGeometry(
      local,
      { geometry: expected.geometry },
      selectors,
      thresholds,
    );
    structureDetail.geometry = geometry.geometry;
    structureFindings.push(...geometry.anomalies);
  }
  if (expected.page_chrome_skeleton) {
    const skeleton = comparePageChromeSkeleton(
      local?.page_chrome_skeleton,
      expected.page_chrome_skeleton,
      expected.page_chrome_skeleton,
    );
    structureDetail.page_chrome_skeleton = skeleton;
    structureFindings.push(...skeleton.anomalies);
  }
  if (expected.attribute_signatures) {
    const attributes = compareAttributeSignatures(
      local?.attribute_signatures ?? [],
      expected.attribute_signatures,
    );
    structureDetail.attributes = attributes;
    structureFindings.push(...attributes.anomalies);
  }
  const computedFindings = [];
  const expectedProperties = expected.custom_properties ?? {};
  const actualProperties =
    local?.document?.custom_properties ?? local?.custom_properties ?? {};
  const computedProperties = Object.entries(expectedProperties).map(
    ([property, expectedValue]) => {
      const actual = actualProperties[property] ?? null;
      return {
        property,
        expected: expectedValue,
        actual,
        status:
          normalizeCssValue(actual) === normalizeCssValue(expectedValue)
            ? "pass"
            : "fail",
      };
    },
  );
  for (const property of computedProperties) {
    if (property.status === "fail") {
      computedFindings.push({
        code: "custom_property_divergence",
        detail: property,
      });
    }
  }
  const presenceFindings = [];
  const expectedProbes = expected.presence_probes ?? [];
  if (expectedProbes.length > 0) {
    const probeResults = evaluatePresenceProbes(
      local?.document?.presence_probes ?? local?.presence_probes ?? [],
      expectedProbes,
    );
    for (const probe of probeResults) {
      if (probe.status === "fail") {
        presenceFindings.push({
          code: "presence_probe_divergence",
          detail: probe,
        });
      }
    }
  }
  const screenshot = screenshotLayer(
    local,
    expected,
    expected.screenshot !== undefined,
  );
  return {
    "dom-signature": dom,
    "structure-geometry": layer(
      statusForFindings(structureFindings),
      structureFindings,
      structureDetail,
    ),
    "computed-style":
      expectedProperties && Object.keys(expectedProperties).length > 0
        ? layer(statusForFindings(computedFindings), computedFindings, {
            properties: computedProperties,
          })
        : layer("not_applicable"),
    "presence-pseudo-layout":
      expectedProbes.length > 0
        ? layer(statusForFindings(presenceFindings), presenceFindings)
        : layer("not_applicable"),
    "screenshot-receipt": screenshot,
  };
}

function liveLayers(local, frozen, thresholds, contract) {
  const dom = exactDomLayer(local, frozen);
  const comparison = compareCaptures(
    local,
    frozen,
    thresholds,
    [],
    contract,
  );
  const classified = classifyCaptureAnomalies(comparison);
  return {
    "dom-signature": dom,
    "structure-geometry": layer(
      statusForFindings(classified.structure),
      classified.structure,
      {
        geometry: comparison.geometry,
        dom_multiset_distance: comparison.dom_multiset_distance,
        page_chrome_skeleton: comparison.page_chrome_skeleton,
        attributes: comparison.attributes,
      },
    ),
    "computed-style": layer(
      statusForFindings(classified.computed),
      classified.computed,
      {
        immediate_custom_properties:
          comparison.domcontentloaded_immediate_custom_properties,
      },
    ),
    "presence-pseudo-layout": layer(
      statusForFindings(classified.presence),
      classified.presence,
      {
        immediate_probes: comparison.domcontentloaded_immediate_probes,
        settled_probes: comparison.settled_probes,
      },
    ),
    "screenshot-receipt": screenshotLayer(local, frozen),
    capture_comparison: comparison,
  };
}

function flattenLayerFindings(layers) {
  return Object.entries(layers)
    .filter(([name]) => SANDBOX_ORACLE_LAYER_NAMES.includes(name))
    .flatMap(([name, value]) =>
      (value.findings ?? []).map((finding) => ({ layer: name, ...finding })),
    );
}

export function compareSandboxOracleFixture({
  fixture,
  local,
  frozen = null,
  thresholds = DEFAULT_THRESHOLDS,
  contract = null,
}) {
  const checkedFixture = validateSandboxOracleFixture(fixture);
  const checkedThresholds = validateThresholds(thresholds);
  if (!isPlainObject(local)) {
    throw new Error(`local capture is required for ${checkedFixture.fixture_id}`);
  }
  let layers;
  if (checkedFixture.assertion_class === "match-live") {
    if (!isPlainObject(frozen)) {
      throw new Error(
        `frozen capture is required for ${checkedFixture.fixture_id}`,
      );
    }
    layers = liveLayers(
      local,
      frozen,
      checkedThresholds,
      contract,
    );
  } else {
    layers = preservedLayers(
      checkedFixture,
      local,
      checkedThresholds,
    );
  }
  const findings = flattenLayerFindings(layers);
  return {
    fixture_id: checkedFixture.fixture_id,
    assertion_class: checkedFixture.assertion_class,
    provenance: checkedFixture.provenance,
    status: findings.length === 0 ? "pass" : "fail",
    verdict: findings.length === 0 ? "match" : "regression",
    layers: Object.fromEntries(
      SANDBOX_ORACLE_LAYER_NAMES.map((name) => [name, layers[name]]),
    ),
    findings,
    ...(layers.capture_comparison
      ? { capture_comparison: layers.capture_comparison }
      : {}),
  };
}

export function aggregateSandboxOracleVerdict({ runId, registry, results }) {
  const checkedRegistry = validateSandboxOracleRegistry(registry);
  if (!Array.isArray(results)) throw new Error("results must be an array");
  const expectedIds = new Set(
    checkedRegistry.fixtures.map((fixture) => fixture.fixture_id),
  );
  const seenIds = new Set();
  for (const result of results) {
    if (!isPlainObject(result) || typeof result.fixture_id !== "string") {
      throw new Error("oracle results must contain fixture_id");
    }
    if (!expectedIds.has(result.fixture_id)) {
      throw new Error(`oracle result is not in the registry: ${result.fixture_id}`);
    }
    if (seenIds.has(result.fixture_id)) {
      throw new Error(`duplicate oracle result: ${result.fixture_id}`);
    }
    seenIds.add(result.fixture_id);
  }
  if (seenIds.size !== expectedIds.size) {
    throw new Error("oracle results do not cover the registry");
  }
  const counts = { pass: 0, fail: 0 };
  for (const result of results) {
    if (!(result.status in counts)) {
      throw new Error(`unsupported oracle result status: ${result.status}`);
    }
    counts[result.status] += 1;
  }
  const verdict = {
    schema: SANDBOX_ORACLE_VERDICT_SCHEMA,
    run_id: requireNonEmptyString(runId, "runId"),
    registry_schema: checkedRegistry.schema,
    fixture_count: checkedRegistry.fixtures.length,
    results,
    aggregate: {
      total: results.length,
      ...counts,
      failing: results
        .filter((result) => result.status === "fail")
        .map((result) => result.fixture_id),
    },
  };
  return { verdict, exitCode: counts.fail > 0 ? 1 : 0 };
}
