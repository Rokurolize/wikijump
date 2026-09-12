import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  PROMOTION_IMAGE_ROLES,
  buildPromotionCandidateImages,
  promotionImageBuildPlan,
  promotionSourceIdentity,
} from "../scripts/build-promotion-candidate-images.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function createPromotionSourceFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-source-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, "deepwell"), {recursive: true});
  await fs.copyFile(path.join(repositoryRoot, "deepwell/Cargo.lock"), path.join(root, "deepwell/Cargo.lock"));
  await fs.writeFile(path.join(root, "tracked.txt"), "tracked\n");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "promotion-source@example.invalid");
  git(root, "config", "user.name", "Promotion Source Test");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

test("promotion candidate image build seals all seven production runtime roles", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-build-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const sourceRoot = repositoryRoot;
  const outputDir = path.join(root, "sealed-build");
  const sourceIdentity = {
    wikijump_commit: "1".repeat(40),
    wikijump_tree: "2".repeat(40),
    ftml_sha: "3".repeat(40),
  };
  const roles = [];
  await buildPromotionCandidateImages({
    sourceRoot,
    outputDir,
    runId: "candidate-build-20260818",
    sourceIdentity,
    buildImage: async (entry) => {
      roles.push(entry.role);
      return {image_id: `sha256:${String(roles.length).repeat(64)}`, os: "linux", architecture: "amd64"};
    },
  });
  assert.deepEqual(roles, PROMOTION_IMAGE_ROLES);
  const images = JSON.parse(await fs.readFile(path.join(outputDir, "images", "final-images.json"), "utf8"));
  assert.deepEqual(images.map(({role}) => role), PROMOTION_IMAGE_ROLES);
  const verdict = JSON.parse(await fs.readFile(path.join(outputDir, "verdict.json"), "utf8"));
  assert.equal(verdict.schema, "wikijump.standing_provenance_build.v1");
  assert.equal(verdict.promotion_eligible, true);
  const seal = JSON.parse(await fs.readFile(path.join(outputDir, "seal.json"), "utf8"));
  assert.equal(seal.schema, "wikijump.standing_provenance_build_seal.v1");
  assert.equal(seal.evidence_manifest_verified, true);
  const manifest = await fs.readFile(path.join(outputDir, "evidence-manifest.sha256"), "utf8");
  assert.match(manifest, /\.\/images\/final-images\.json/u);
  assert.match(manifest, /\.\/image-producer\.json/u);
});

test("promotion image plan uses production application images and a candidate-seed-capable Deepwell image", async () => {
  const plan = promotionImageBuildPlan(repositoryRoot);
  assert.deepEqual(plan.map(({role}) => role), PROMOTION_IMAGE_ROLES);
  assert.match(plan.find(({role}) => role === "deepwell").dockerfile, /install\/prod\/deepwell\/Dockerfile$/u);
  assert.deepEqual(plan.find(({role}) => role === "framerail").build_args, ["FRAMERAIL_ENV=local", "FRAMERAIL_CSRF_CHECK_ORIGIN=true"]);
  const deepwellDockerfile = await fs.readFile(path.join(repositoryRoot, "install/prod/deepwell/Dockerfile"), "utf8");
  assert.match(deepwellDockerfile, /COPY \.\/deepwell\/seeder \/opt\/deepwell\/seeder/u);
});

test("promotion source identity ignores unrelated operator overlays but rejects build-input dirt", async (t) => {
  const sourceRoot = await createPromotionSourceFixture(t);
  await fs.writeFile(path.join(sourceRoot, "operator-overlay.txt"), "untracked operator state\n");
  const identity = await promotionSourceIdentity(sourceRoot);
  assert.match(identity.wikijump_commit, /^[0-9a-f]{40}$/u);
  assert.match(identity.wikijump_tree, /^[0-9a-f]{40}$/u);
  assert.match(identity.ftml_sha, /^[0-9a-f]{40}$/u);

  await fs.writeFile(path.join(sourceRoot, "deepwell/untracked.rs"), "// build input dirt\n");
  await assert.rejects(
    promotionSourceIdentity(sourceRoot),
    /promotion candidate build inputs contain untracked files: deepwell\/untracked\.rs/u,
  );
  await fs.rm(path.join(sourceRoot, "deepwell/untracked.rs"));

  await fs.appendFile(path.join(sourceRoot, "tracked.txt"), "dirty\n");
  await assert.rejects(
    promotionSourceIdentity(sourceRoot),
    /promotion candidate tracked source must be clean/u,
  );
});
