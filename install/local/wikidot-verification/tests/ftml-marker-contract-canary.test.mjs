import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  composeDocument,
  pageMutationContext,
  parseArgs,
  readSeedAdministrator,
  replaceFtmlPin,
  selectFtmlPinRewrite,
} from "../scripts/run-ftml-marker-contract-canary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const script = path.join(
  here,
  "..",
  "scripts",
  "run-ftml-marker-contract-canary.mjs",
);
const candidateFtml = "a8fcd3dce089aefd6a9a3619116d4777c9ebd7cc";
const requiredSurfaces = ["heading", "separator", "div", "span", "alignment"];

test("committed receipt binds the exact manifest, lock, and five-surface contract", () => {
  const manifest = readFileSync(
    path.join(repositoryRoot, "deepwell/Cargo.toml"),
    "utf8",
  );
  const lock = readFileSync(
    path.join(repositoryRoot, "deepwell/Cargo.lock"),
    "utf8",
  );
  const receipt = JSON.parse(
    readFileSync(
      path.join(
        repositoryRoot,
        "install/local/wikidot-verification/artifacts",
        "ftml-block-argument-pin-canary-20260801.json",
      ),
      "utf8",
    ),
  );

  assert.equal(
    manifest.match(
      new RegExp(
        `ftml = \\{ git = "https://github\\.com/Rokurolize/ftml", rev = "${candidateFtml}" \\}`,
        "gu",
      ),
    )?.length,
    1,
  );
  assert.equal(
    lock.match(
      new RegExp(
        `source = "git\\+https://github\\.com/Rokurolize/ftml\\?rev=${candidateFtml}#${candidateFtml}"`,
        "gu",
      ),
    )?.length,
    1,
  );
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.candidate_ftml_sha, candidateFtml);
  assert.deepEqual(receipt.required_surfaces, requiredSurfaces);
  assert.deepEqual(receipt.comparison, {
    schema: "wikijump_local_lab.render_compare.v1",
    pairs_total: requiredSurfaces.length,
    matches: requiredSurfaces.length,
    accepted_differences: 0,
    regressions: 0,
    verdict_sha256:
      "6463d478a6a1b087240deb1b1ac0d54f6f87608372c3f4f0c5e9510400217f83",
  });
  assert.deepEqual(receipt.resource_disposition, {
    policy: "delete-on-close",
    disposable_containers_remaining: 0,
  });
});

test("marker canary authenticates page mutations in the exact page context", () => {
  const context = pageMutationContext(
    {
      "X-Deepwell-Session-Token": "session-token",
      "X-Deepwell-Site-Id": "42",
    },
    "marker-heading",
  );
  assert.deepEqual(context, {
    "X-Deepwell-Session-Token": "session-token",
    "X-Deepwell-Site-Id": "42",
    "X-Deepwell-Page": "marker-heading",
  });
});

test("marker canary changes the manifest and lock to the same FTML revision", () => {
  const baselineFtml = "1".repeat(40);
  const candidateFtml = "2".repeat(40);
  const manifest = `ftml = { git = "https://github.com/Rokurolize/ftml", rev = "${baselineFtml}" }\n`;

  assert.equal(
    replaceFtmlPin(manifest, baselineFtml, candidateFtml),
    `ftml = { git = "https://github.com/Rokurolize/ftml", rev = "${candidateFtml}" }\n`,
  );
  assert.throws(
    () => replaceFtmlPin(manifest, "3".repeat(40), candidateFtml),
    /source FTML pin exactly once/u,
  );
});

test("marker canary preserves whichever side already equals exact HEAD", () => {
  const baselineFtml = "1".repeat(40);
  const candidateFtml = "2".repeat(40);

  assert.deepEqual(
    selectFtmlPinRewrite(baselineFtml, baselineFtml, candidateFtml),
    {
      stage: "candidate",
      sourceFtml: baselineFtml,
      targetFtml: candidateFtml,
    },
  );
  assert.deepEqual(
    selectFtmlPinRewrite(candidateFtml, baselineFtml, candidateFtml),
    {
      stage: "baseline",
      sourceFtml: candidateFtml,
      targetFtml: baselineFtml,
    },
  );
  assert.throws(
    () => selectFtmlPinRewrite("3".repeat(40), baselineFtml, candidateFtml),
    /matches neither baseline/u,
  );
  assert.throws(
    () => selectFtmlPinRewrite(baselineFtml, baselineFtml, baselineFtml),
    /must be distinct/u,
  );
});

test("marker canary module parses sliced argv and injects run-owned credentials", async () => {
  const parsed = parseArgs([
    "--candidate-ftml",
    candidateFtml,
    "--output-dir",
    "/tmp/ftml-marker-contract-test",
    "--dry-run",
  ]);
  assert.equal(parsed.candidateFtml, candidateFtml);
  assert.equal(parsed.dryRun, true);

  const administrator = await readSeedAdministrator(repositoryRoot);
  assert.equal(administrator.email, "admin@wikijump");
  assert.equal(administrator.password.length > 0, true);

  const compose = composeDocument({
    project: "marker-test",
    images: {
      database: "database-image",
      cache: "cache-image",
      files: "files-image",
      deepwell: "deepwell-image",
      framerail: "framerail-image",
    },
    labels: { "example.label": "value" },
    binary: "/private/deepwell",
    config: "/private/config.toml",
    migrations: "/private/migrations",
    locales: "/private/locales",
    deepwellPort: 42747,
    framerailPort: 43393,
    credentials: {
      databasePassword: "database-secret",
      filesAccessKey: "marker-access-key",
      filesSecretKey: "files-secret",
    },
  });
  assert.match(compose, /POSTGRES_PASSWORD: "database-secret"/u);
  assert.match(
    compose,
    /DATABASE_URL: "postgres:\/\/wikijump:database-secret@database\/wikijump"/u,
  );
  assert.match(compose, /MINIO_ROOT_PASSWORD: "files-secret"/u);
  assert.doesNotMatch(compose, /defaultpassword/u);
});

test("marker canary dry run requires the exact five marker surfaces", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--candidate-ftml",
      candidateFtml,
      "--output-dir",
      "/tmp/ftml-marker-contract-test",
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.required_surfaces, requiredSurfaces);
  assert.deepEqual(
    plan.fixtures.map((fixture) => fixture.surface).sort(),
    [...plan.required_surfaces].sort(),
  );
  assert.equal(plan.resource_disposition, "delete-on-close");
  assert.equal(plan.baseline_ftml, null);
});

test("marker canary rejects abbreviated FTML revisions", () => {
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--candidate-ftml",
      "b3e2cca4",
      "--output-dir",
      "/tmp/ftml-marker-contract-test",
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full lowercase SHA/u);
});
