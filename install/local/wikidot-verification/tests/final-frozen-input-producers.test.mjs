import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompatibilityReview,
  parseArgs as parseReviewArgs,
} from "../scripts/emit-compatibility-review.mjs";
import {
  buildSourceWriterRoster,
  parseArgs as parseRosterArgs,
} from "../scripts/emit-source-writer-roster.mjs";
import {
  buildFinalFrozenInputManifest,
  parseArgs as parseManifestArgs,
} from "../scripts/build-final-frozen-input-manifest.mjs";

const source = {
  wikijump_commit: "a".repeat(40),
  wikijump_tree: "b".repeat(40),
  ftml_sha: "c".repeat(40),
};

test("review attestation seals only an explicit zero-finding review for one axis", () => {
  const review = buildCompatibilityReview({axis: "standards", source, attestation: "zero-findings-reviewed"});
  assert.equal(review.status, "pass");
  assert.deepEqual(review.findings, []);
  assert.throws(() => buildCompatibilityReview({axis: "standards", source, attestation: "pass"}), /explicit zero-findings-reviewed/u);
  assert.throws(() => buildCompatibilityReview({axis: "combined", source, attestation: "zero-findings-reviewed"}), /standards or spec/u);
});

test("source writer roster is exact-source and requires unique stopped lanes", () => {
  const roster = buildSourceWriterRoster({source, lanes: ["primary-checkout"]});
  assert.deepEqual(roster.lanes, [{name: "primary-checkout", state: "stopped"}]);
  assert.throws(() => buildSourceWriterRoster({source, lanes: []}), /one or more lane/u);
  assert.throws(() => buildSourceWriterRoster({source, lanes: ["one", "one"]}), /unique/u);
});

test("final frozen input manifest is produced from explicit source-owned path classes", () => {
  const manifest = buildFinalFrozenInputManifest({
    lockfile: ["/repo/deepwell/Cargo.lock"],
    verifier: ["/repo/verify-final-zero.mjs"],
    fixture: ["/repo/inventory.json"],
    tool: ["/repo/build-candidate.mjs"],
    denominator: ["/evidence/denominator.json"],
    "standards-review": "/evidence/standards.json",
    "spec-review": "/evidence/spec.json",
    images: "/evidence/image-producer.json",
  });
  assert.equal(manifest.reviews.standards, "/evidence/standards.json");
  assert.equal(manifest.images, "/evidence/image-producer.json");
});

test("final freeze producer CLIs consume every flag-value pair", () => {
  assert.equal(
    parseReviewArgs([
      "--source-root", "/repo", "--axis", "standards", "--attestation", "zero-findings-reviewed", "--output", "/review.json",
    ]).axis,
    "standards",
  );
  assert.deepEqual(
    parseRosterArgs([
      "--source-root", "/repo", "--lane", "primary", "--lane", "secondary", "--output", "/writers.json",
    ]).lane,
    ["primary", "secondary"],
  );
  const manifest = parseManifestArgs([
    "--lockfile", "/repo/deepwell/Cargo.lock",
    "--verifier", "/repo/verify.mjs",
    "--fixture", "/repo/inventory.json",
    "--tool", "/repo/tool.mjs",
    "--denominator", "/evidence/denominator.json",
    "--standards-review", "/evidence/standards.json",
    "--spec-review", "/evidence/spec.json",
    "--images", "/evidence/images.json",
    "--output", "/evidence/inputs.json",
  ]);
  assert.equal(manifest["standards-review"], "/evidence/standards.json");
  assert.equal(manifest.output, "/evidence/inputs.json");
});
