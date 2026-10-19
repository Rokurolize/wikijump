import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyConsolidatedChecks,
  parsePreflightOutput,
  runConsolidatedValidation,
} from "../scripts/run-consolidated-validation.mjs";
import { validateConsolidatedValidation } from "../src/final-frozen-receipt-contract.mjs";

const COMPATIBLE_OUTPUT = [
  "preflight: groups: deepwell=false wws=false framerail=false theme_lab=true verification=false",
  "=== source-bound generated contracts",
  "--- source-bound generated contracts: ok (1s)",
  "=== Theme Lab adaptation authority",
  "--- Theme Lab adaptation authority: ok (1s)",
  "=== Theme Lab current campaign completion",
  "--- Theme Lab current campaign completion: INCONCLUSIVE (1s)",
  "preflight: INCONCLUSIVE (no current campaign): Theme Lab current campaign completion",
  "preflight: all selected checks passed",
];

async function runFixture(t, label, lines, exitCode = 0, imageBuild = false) {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "theme-lab-inconclusive-"),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, "repo");
  const script = path.join(repo, "scripts/preflight.sh");
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(
    script,
    `#!/usr/bin/env bash\nprintf '%s\\n' ${lines.map((line) => `'${line.replaceAll("'", "'\\''")}'`).join(" ")}\nexit ${exitCode}\n`,
  );
  for (const source of [
    "scripts/run-test-no-external-network.sh",
    "install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs",
  ]) {
    const target = path.join(repo, source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `# ${label}\n`);
  }
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "--quiet", repo]);
  git("config", "user.email", "local-test@example.invalid");
  git("config", "user.name", "Theme Lab validation fixture");
  git("add", ".");
  git("commit", "-qm", label);
  const output = path.join(temp, "receipt.json");
  const { receipt } = await runConsolidatedValidation({
    repository: repo,
    base: "HEAD",
    output,
    log: path.join(temp, "preflight.log"),
    groups: "theme_lab",
    imageBuild,
    buildImages: async () => ({}),
  });
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), receipt);
  assert.equal(receipt.wikijump_commit, git("rev-parse", "HEAD"));
  assert.equal(receipt.wikijump_tree, git("rev-parse", "HEAD^{tree}"));
  // Verify the *actual sealed Node receipt* through the Python Standing
  // admission reader. This exercises the cross-language seam, not just a
  // separately constructed mock with the desired status already filled in.
  const standingDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../standing",
  );
  const admitted = execFileSync(
    "python3",
    [
      "-c",
      [
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, sys.argv[1])",
        "import promote",
        "print(len(promote.validation_receipts(Path(sys.argv[2]))))",
      ].join("; "),
      standingDir,
      temp,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(admitted, receipt.status === "pass" ? "1" : "0");
  return receipt;
}

test("missing current campaign produces sealed code PASS with explicit INCONCLUSIVE, but NOT publication acceptance", async (t) => {
  const receipt = await runFixture(t, "no-current-campaign", COMPATIBLE_OUTPUT);
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.preflight.exit, 0);
  assert.deepEqual(
    receipt.checks.map((row) => row.status),
    ["ok", "ok", "inconclusive"],
  );
  assert.deepEqual(
    classifyConsolidatedChecks(
      receipt.preflight.exit,
      receipt.groups,
      receipt.checks,
    ),
    {
      passed: true,
      failed: [],
      inconclusive: ["Theme Lab current campaign completion"],
    },
  );
  assert.throws(
    () =>
      validateConsolidatedValidation(receipt, {
        wikijump_commit: receipt.wikijump_commit,
        wikijump_tree: receipt.wikijump_tree,
      }),
    /did not pass: Theme Lab current campaign completion/u,
  );
});

test("source/authority failures and nonzero preflight exit never turn into PASS", async (t) => {
  const failedAuthority = COMPATIBLE_OUTPUT.map((row) =>
    row.replace(
      "Theme Lab adaptation authority: ok",
      "Theme Lab adaptation authority: FAILED",
    ),
  );
  const receipt = await runFixture(t, "failed-authority", failedAuthority, 1);
  assert.equal(receipt.status, "fail");
  assert.deepEqual(
    classifyConsolidatedChecks(
      receipt.preflight.exit,
      receipt.groups,
      receipt.checks,
    ).failed,
    ["Theme Lab adaptation authority"],
  );
});

test("an arbitrary INCONCLUSIVE check cannot bypass the barrier", async (t) => {
  const output = COMPATIBLE_OUTPUT.map((line) =>
    line.replaceAll(
      "Theme Lab current campaign completion",
      "Theme Lab source evidence",
    ),
  );
  const receipt = await runFixture(t, "wrong-inconclusive", output);
  assert.equal(receipt.status, "fail");
  assert.deepEqual(
    classifyConsolidatedChecks(
      receipt.preflight.exit,
      receipt.groups,
      receipt.checks,
    ).failed,
    ["Theme Lab source evidence"],
  );
});

test("an absent check or an INCONCLUSIVE-only run cannot claim code validation PASS", () => {
  assert.equal(
    classifyConsolidatedChecks(0, { theme_lab: true }, []).passed,
    false,
  );
  assert.equal(
    classifyConsolidatedChecks(0, { theme_lab: true }, [
      { name: "Theme Lab current campaign completion", status: "inconclusive" },
    ]).passed,
    false,
  );
  assert.equal(
    classifyConsolidatedChecks(0, { theme_lab: false }, [
      { name: "source authority", status: "ok" },
      { name: "Theme Lab current campaign completion", status: "inconclusive" },
    ]).passed,
    false,
  );
});

test("a passing image build alone never passes an absent source preflight", async (t) => {
  const receipt = await runFixture(
    t,
    "empty-preflight",
    ["preflight: groups: theme_lab=true"],
    0,
    true,
  );
  assert.equal(receipt.status, "fail");
  assert.deepEqual(
    receipt.checks.map((row) => row.name),
    ["standing images build"],
  );
});

test("nested child preflight status lines do not contaminate the enclosing check", () => {
  const parsed = parsePreflightOutput(
    [
      "preflight: groups: verification=true theme_lab=false",
      "=== wikidot verification tests",
      "=== Theme Lab adaptation authority",
      "--- Theme Lab adaptation authority: FAILED (1s)",
      "=== Theme Lab current campaign completion",
      "--- Theme Lab current campaign completion: INCONCLUSIVE (1s)",
      "--- wikidot verification tests: ok (63s)",
    ].join("\n"),
  );
  assert.deepEqual(parsed.checks, [
    { name: "wikidot verification tests", status: "ok", duration_seconds: 63 },
  ]);
});
