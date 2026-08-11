import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const casesPath = path.join(root, "install/local/wikidot-verification/fixtures/userinfo-target-routes/cases.json");
const artifactPath = path.join(root, "install/local/wikidot-verification/artifacts/userinfo-target-routes-live-20260810.json");
const sha256Pattern = /^[0-9a-f]{64}$/u;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function objectValues(value) {
  if (Array.isArray(value)) return value.flatMap(objectValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(objectValues);
  return [value];
}

test("UserInfo target-route evidence covers two public users and two numeric missing controls for both actors", () => {
  const cases = readJson(casesPath);
  const artifact = readJson(artifactPath);

  assert.equal(cases.schema, "wikijump.userinfo_target_routes.cases.v1");
  assert.deepEqual(cases.surface_ids, [
    "catalog-feature:module-userinfo",
    "open43-audit-case:Q1032_REMAINING_DIRECTORY_RUNTIME"
  ]);
  assert.equal(cases.public_interface, "GET https://www.wikidot.com/user:info/<target>");
  assert.equal(cases.mutated, false);
  assert.deepEqual(cases.targets.filter(({kind}) => kind === "public-user").map(({public_user_id}) => public_user_id), [169306, 1698600]);
  assert.deepEqual(cases.targets.filter(({kind}) => kind === "missing-numeric-id").map(({route_target}) => route_target), ["0", "-1"]);
  assert.equal(cases.prior_no_target_negative_control.classification, "negative-control-only");
  assert.equal(cases.prior_no_target_negative_control.captured_in_this_lane, false);
  assert.equal(cases.cases.length, 8);

  assert.equal(artifact.schema, "wikijump.userinfo_target_routes.live_evidence.v1");
  assert.equal(artifact.cases_sha256.match(sha256Pattern)?.[0], artifact.cases_sha256);
  assert.equal(artifact.mutated, false);
  assert.deepEqual(artifact.surface_ids, cases.surface_ids);
  assert.equal(artifact.public_interface, cases.public_interface);
  assert.equal(artifact.observations.length, cases.cases.length);
  assert.deepEqual(artifact.observations.map(({case_id}) => case_id), cases.cases.map(({case_id}) => case_id));

  const targets = new Map(cases.targets.map((target) => [target.target_id, target]));
  for (const observation of artifact.observations) {
    const target = targets.get(observation.target_id);
    assert.ok(target, observation.case_id);
    assert.equal(observation.request.method, "GET");
    assert.equal(observation.request.url, `https://www.wikidot.com/user:info/${target.route_target}`);
    assert.deepEqual(observation.redirect_chain, []);
    assert.equal(observation.response.status, 200);
    assert.match(observation.response.content_type, /^text\/html\b/iu);
    assert.equal(observation.response.final_url, observation.request.url);
    assert.match(observation.response.body_sha256, sha256Pattern);
    assert.match(observation.response.bounded_body_sha256, sha256Pattern);
    assert.match(observation.response.normalized_bounded_body_sha256, sha256Pattern);
    assert.ok(observation.response.bounded_body.length <= artifact.capture_policy.maximum_bounded_body_characters);
    assert.doesNotMatch(observation.response.bounded_body, /\/account\/messages/iu);
    assert.deepEqual([...observation.dom.class_tokens].sort(), observation.dom.class_tokens);
    assert.equal(new Set(observation.dom.class_tokens).size, observation.dom.class_tokens.length);
    assert.equal(observation.dom.safe_links.every(({href}) => !href.includes("/account/messages")), true);
    assert.equal(observation.dom.private_message_control_present, target.kind === "public-user");
    assert.equal(observation.response.bounded_body_redactions.private_message_destination_links, target.kind === "public-user" ? 1 : 0);

    if (target.expected_result === "populated-profile") {
      assert.equal(observation.result, "populated-profile");
      assert.equal(observation.dom.profile.public_name, target.public_name);
      assert.equal(observation.dom.profile.public_user_id, target.public_user_id);
      assert.equal(observation.dom.error, null);
      assert.equal(observation.dom.avatar.src.includes(`userid=${target.public_user_id}`), true);
      assert.deepEqual(observation.dom.public_fields.map(({label}) => label), ["Wikidot user since:", "Account type:", "Karma level:"]);
      assert.equal(observation.dom.class_tokens.includes("profile-title"), true);
      assert.equal(observation.dom.class_tokens.includes("profile-box"), true);
    } else {
      assert.equal(observation.result, "user-does-not-exist");
      assert.equal(observation.dom.error, "User does not exist.");
      assert.equal(observation.dom.profile, null);
      assert.equal(observation.dom.avatar, null);
      assert.deepEqual(observation.dom.public_fields, []);
      assert.deepEqual(observation.dom.safe_links, []);
      assert.equal(observation.dom.class_tokens.includes("error-block"), true);
    }
  }

  for (const target of cases.targets) {
    const pair = artifact.observations.filter((observation) => observation.target_id === target.target_id);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].response.normalized_bounded_body_sha256, pair[1].response.normalized_bounded_body_sha256);
    assert.equal(pair[0].result, pair[1].result);
  }

  assert.deepEqual(artifact.actor_differential, {
    compared_targets: 4,
    differing_normalized_bodies: 0,
    conclusion: "No anonymous versus Account A differential was observed in the bounded UserInfo content."
  });
  assert.deepEqual(artifact.controls, {positive_actor_cases: 4, negative_actor_cases: 4, prior_no_target_negative_cases: 2});
  assert.equal(artifact.privacy_review.credentials_or_cookie_hits, 0);
  assert.equal(artifact.privacy_review.private_fields_captured, false);
  assert.equal(artifact.privacy_review.messages_captured, false);
  assert.equal(artifact.privacy_review.email_addresses_captured, false);
  assert.equal(artifact.privacy_review.account_a_identity, "redacted-sandbox-account-a");

  const scalarText = objectValues(artifact).filter((value) => typeof value === "string").join("\n");
  assert.doesNotMatch(scalarText, /WIKIDOT_SESSION_ID|wikidot_token7|authorization|set-cookie/iu);
  assert.doesNotMatch(scalarText, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  assert.equal(scalarText.includes("No user specified."), true);
});
