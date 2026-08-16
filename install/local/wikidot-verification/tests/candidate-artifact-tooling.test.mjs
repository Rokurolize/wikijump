import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const verificationRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = path.resolve(verificationRoot, "../../..");
const manifestTool = path.join(
  verificationRoot,
  "scripts/candidate-artifact-manifest.py",
);
const buildWrapper = path.join(
  verificationRoot,
  "scripts/build-deepwell-candidate.sh",
);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
  });
}

test("candidate artifact tooling is source-owned and fail-closed", () => {
  const lock = path.join(repositoryRoot, "deepwell/Cargo.lock");
  const lockText = fs.readFileSync(lock, "utf8");
  const pinnedFtml = Array.from(
    lockText.matchAll(
      /name = "ftml"[\s\S]*?source = "git\+https:\/\/github\.com\/Rokurolize\/ftml[^#"]*#([0-9a-f]{40})"/gu,
    ),
    (match) => match[1],
  );
  assert.equal(pinnedFtml.length, 1);
  const currentFtml = run("python3", [
    manifestTool,
    "ftml-sha",
    "--cargo-lock",
    lock,
  ]);
  assert.equal(currentFtml.status, 0, currentFtml.stderr);
  assert.equal(currentFtml.stdout.trim(), pinnedFtml[0]);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-artifact-tooling-"));
  try {
    const legacy = path.join(temporary, "legacy.json");
    fs.writeFileSync(legacy, '{"schema":"legacy"}\n');
    const diagnostic = run("python3", [
      manifestTool,
      "verify",
      "--manifest",
      legacy,
      "--gate-mode",
      "diagnostic",
    ]);
    assert.equal(diagnostic.status, 0, diagnostic.stderr);
    assert.equal(JSON.parse(diagnostic.stdout).status, "legacy_unverified");

    const acceptance = run("python3", [
      manifestTool,
      "verify",
      "--manifest",
      legacy,
      "--gate-mode",
      "acceptance",
    ]);
    assert.equal(acceptance.status, 1, acceptance.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const help = run("/usr/bin/bash", [buildWrapper, "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /build-deepwell-candidate\.sh/u);

  for (const relative of [
    "install/local/wikidot-verification/scripts/run-ftml-marker-contract-canary.mjs",
    "install/local/wikidot-verification/src/listpages-runtime-authority.mjs",
  ]) {
    const source = fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    assert.doesNotMatch(source, /\/home\/roku\/wjlab\/scripts\/(?:candidate-artifact-manifest\.py|build-deepwell-candidate\.sh)/u);
  }
});
