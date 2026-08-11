import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const cases = JSON.parse(await readFile(new URL("fixtures/data-form-images-links-youtube/cases.json", root), "utf8"));
const artifact = JSON.parse(await readFile(new URL("artifacts/data-form-images-links-youtube-live-20260810.json", root), "utf8"));

const phases = [
  "create_form",
  "create_submission",
  "create_saved_source",
  "create_storage",
  "create_display",
  "edit_form",
  "edit_submission",
  "edit_saved_source",
  "edit_storage",
  "edit_display",
  "reload",
  "cleanup",
];

function countControls(feature, polarity) {
  return feature.attempted_rule.controls.filter((control) => control.polarity === polarity).length;
}

function forbiddenKeys(value, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenKeys(item, [...path, index]));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const keyPath = [...path, key];
    const matches = /(?:password|cookie|csrf|token7|session|lock_secret|lock_id|login_id|email|account_id)/i.test(key)
      ? [keyPath.join(".")]
      : [];
    return [...matches, ...forbiddenKeys(child, keyPath)];
  });
}

function stringLeaves(value) {
  if (Array.isArray(value)) {
    return value.flatMap(stringLeaves);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(stringLeaves);
  }
  return typeof value === "string" ? [value] : [];
}

test("media and links artifact has the exact independent feature contract", () => {
  assert.equal(artifact.schema, "wikidot.live.data-form.images-links-youtube.v1");
  assert.equal(artifact.site, cases.site);
  assert.deepEqual(artifact.surface_ids, cases.surface_ids);
  assert.deepEqual(artifact.features.map(({feature}) => feature), cases.features.map(({feature}) => feature));
  assert.equal(new Set(artifact.features.map(({surface_id}) => surface_id)).size, 3);
  assert.equal(new Set(artifact.features.map(({attempted_rule}) => attempted_rule.rule_id)).size, 3);
});

for (const expectedFeature of cases.features) {
  test(`${expectedFeature.feature} remains independent and records every lifecycle phase`, () => {
    const actual = artifact.features.find(({feature}) => feature === expectedFeature.feature);
    assert.ok(actual, `missing ${expectedFeature.feature}`);
    assert.equal(actual.surface_id, expectedFeature.surface_id);
    assert.deepEqual(actual.fixture_matrix, expectedFeature.matrix);
    assert.deepEqual(actual.attempted_rule, expectedFeature.attempted_rule);
    assert.equal(countControls(actual, "positive"), 2);
    assert.equal(countControls(actual, "negative"), 2);
    assert.deepEqual(Object.keys(actual.phases), phases);
    for (const phase of phases) {
      assert.equal(typeof actual.phases[phase], "object", `${expectedFeature.feature}.${phase}`);
      assert.notEqual(actual.phases[phase], null, `${expectedFeature.feature}.${phase}`);
    }
  });
}

test("terminal status cannot promote partial or blocked observations", () => {
  assert.ok(["observed", "blocked"].includes(artifact.status));
  assert.ok(artifact.features.every(({status}) => ["observed", "blocked"].includes(status)));
  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.ok(artifact.features.some(({status}) => status === "blocked"));
    assert.equal(typeof artifact.blocked_reason, "string");
    assert.ok(artifact.blocked_reason.length > 0);
    assert.equal(typeof artifact.missing_authority, "string");
    assert.ok(artifact.missing_authority.length > 0);
  } else {
    assert.ok(artifact.features.every(({status}) => status === "observed"));
    assert.equal(artifact.promoted_rules.length, 3);
    assert.ok(artifact.promoted_rules.every(({controls}) => controls.length === 4 && controls.every(({passed}) => passed === true)));
  }
});

test("capture is public-interface-only, secret-free, remote-fetch-free, and cleaned", () => {
  assert.deepEqual(forbiddenKeys(artifact), []);
  const serializedLeaves = stringLeaves(artifact).join("\n");
  assert.doesNotMatch(serializedLeaves, /WIKIDOT_(?:USERNAME|PASSWORD|SESSION_ID)|wikidot_token7|set-cookie|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
  assert.deepEqual(artifact.remote_media_fetches, []);
  assert.deepEqual(artifact.actors, ["account-a", "anonymous"]);
  assert.ok(Array.isArray(artifact.public_interfaces_used));
  assert.ok(artifact.public_interfaces_used.length > 0);
  assert.equal(artifact.cleanup.verified, true);
  assert.deepEqual(artifact.cleanup.remaining_pages, []);
  assert.deepEqual(artifact.cleanup.remaining_attachments, []);
  assert.equal(artifact.credentials_exposed, false);
});
