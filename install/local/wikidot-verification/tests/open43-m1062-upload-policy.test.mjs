import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateOpen43M1062UploadPolicyFixture,
  verifyOpen43M1062UploadPolicyArtifact,
} from "../src/open43-m1062-upload-policy.mjs";

const fixtureBytes = await readFile(new URL("../fixtures/open43-m1062-upload-policy/cases.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");

function artifactBase(status = "observed") {
  return {
    schema: "wikidot.live.open43.m1062.upload-policy.v1",
    status,
    run_id: "parent-run-1062",
    site: "sandbox-for-codex",
    target_surface_ids: fixture.target_surface_ids,
    source_identity: { wikijump_commit: "a".repeat(40) },
    fixture_sha256: fixtureSha256,
    producer_sha256: "b".repeat(64),
    mutation_performed: status === "observed",
    baseline_inventory: [],
    cases: [],
    policy_observations: "recorded_without_promotion",
    promoted_rules: [],
    cleanup: { verified: true, page_absent: true, remaining_run_owned_objects: [] },
  };
}

function observedCase(definition, index) {
  const bytes = Buffer.from(definition.payload_utf8, "utf8");
  const payloadSha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    case_id: definition.case_id,
    request: {
      source_filename: definition.source_filename,
      override_name: definition.override_name,
      byte_length: bytes.length,
      payload_sha256: payloadSha256,
    },
    response: {
      http_status: definition.case_id === "second-same-name" ? 409 : 200,
      content_type: "text/html; charset=utf-8",
      location: null,
      body_size: 12,
      body_sha256: (String(index + 1).repeat(64)).slice(0, 64),
    },
    inventory_before: [],
    inventory_after: [],
    new_file_ids: [],
    displayed_names: [],
    result: "unknown",
  };
}

test("#1062 fixture is the bounded five-case naming matrix", () => {
  validateOpen43M1062UploadPolicyFixture(fixture);
  assert.deepEqual(fixture.case_order, [
    "first-same-name",
    "second-same-name",
    "unicode-filename",
    "empty-override-name",
    "explicit-override-name",
  ]);
});

test("#1062 verifier accepts complete observations without promoting policy", () => {
  const artifact = artifactBase();
  artifact.cases = fixture.cases.map(observedCase);
  assert.deepEqual(
    verifyOpen43M1062UploadPolicyArtifact(fixture, artifact, { fixtureSha256 }),
    { verified: true, status: "observed", policy_promoted: false, case_count: 5 },
  );
});

test("#1062 verifier accepts a no-mutation blocker but never treats it as policy evidence", () => {
  const artifact = artifactBase("blocked");
  artifact.mutation_performed = false;
  artifact.blocked_reason = "parent run has not authorized the run-owned mutation";
  assert.deepEqual(
    verifyOpen43M1062UploadPolicyArtifact(fixture, artifact, { fixtureSha256 }),
    { verified: true, status: "blocked", policy_promoted: false },
  );
});

test("#1062 verifier rejects incomplete, dirty, or guessed authority", () => {
  const incomplete = artifactBase();
  incomplete.cases = fixture.cases.slice(0, -1).map(observedCase);
  assert.throws(() => verifyOpen43M1062UploadPolicyArtifact(fixture, incomplete, { fixtureSha256 }), /evidence is incomplete/u);

  const promoted = artifactBase();
  promoted.cases = fixture.cases.map(observedCase);
  promoted.promoted_rules = [{ rule_id: "guessed-duplicate-policy" }];
  assert.throws(() => verifyOpen43M1062UploadPolicyArtifact(fixture, promoted, { fixtureSha256 }), /cannot promote/u);

  const dirty = artifactBase();
  dirty.cases = fixture.cases.map(observedCase);
  dirty.cleanup = { verified: true, remaining_run_owned_objects: ["open43-m1062-parent-run-1062"] };
  assert.throws(() => verifyOpen43M1062UploadPolicyArtifact(fixture, dirty, { fixtureSha256 }), /cleanup/u);
});
