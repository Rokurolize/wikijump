import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createDeepwellRuntimeIdentity } from "../src/deepwell-runtime-identity.mjs";
import { prepareCurrentRuntimeContract } from "../src/current-runtime-contract-builder.mjs";
import { validatePublicationCandidateSet } from "../src/publication-candidate-freeze.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const template = JSON.parse(
  fs.readFileSync(
    path.join(
      repo,
      "install/local/theme-lab/ports/current-acceptance/run-contract.json",
    ),
    "utf8",
  ),
);
const identity = createDeepwellRuntimeIdentity({
  source_sha256: "1".repeat(64),
  ftml_git_revision: "2".repeat(40),
  container_id: "3".repeat(64),
  image_id: `sha256:${"4".repeat(64)}`,
  binary_sha256: "5".repeat(64),
  config_sha256: "6".repeat(64),
});
const FROZEN_SHA = "7".repeat(64);
const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-lab-contract-candidate-"));
fs.mkdirSync(path.join(candidateRoot, "publication"));
fs.writeFileSync(
  path.join(candidateRoot, "publication", "frozen-candidate-set.json"),
  JSON.stringify({ candidate_set_sha256: FROZEN_SHA }),
);
process.on("exit", () =>
  fs.rmSync(candidateRoot, { recursive: true, force: true }),
);
const passingCandidateSet = { root: candidateRoot, validate: () => [] };
const input = {
  runId: "basalt-source-20261019",
  port: 3396,
  framerailSourceSha: "a".repeat(64),
  backendRuntimeIdentity: identity,
  candidateSet: passingCandidateSet,
};

test("new run contract binds measured source and backend without rewriting frozen source authority", () => {
  const oldBytes = JSON.stringify(template);
  const result = prepareCurrentRuntimeContract(template, input);
  assert.equal(result.expected_runtime_source_sha256, input.framerailSourceSha);
  assert.deepEqual(result.expected_backend_runtime_identity, identity);
  assert.equal(
    result.target_site.origin,
    "https://scpaiueouiuiuiui.wikijump.localhost:3396",
  );
  assert.equal(
    result.artifact_namespace,
    `current-acceptance/sigma9/${input.runId}`,
  );
  assert.equal(
    result.audit_path,
    `runs/${input.runId}/interactive-visual-audit.json`,
  );
  assert.deepEqual(result.baseline_theme, template.baseline_theme);
  assert.deepEqual(result.visual_gate_policy, template.visual_gate_policy);
  assert.deepEqual(
    result.additional_candidates,
    template.additional_candidates,
  );
  assert.equal(result.candidate_set_sha256, FROZEN_SHA);
  assert.notEqual(
    FROZEN_SHA,
    template.candidate_set_sha256,
    "the contract must come from the frozen set, not the template",
  );
  assert.equal(
    JSON.stringify(template),
    oldBytes,
    "the historic template must stay unchanged",
  );
  const next = prepareCurrentRuntimeContract(template, {
    ...input,
    runId: "another-task",
    port: 3397,
  });
  assert.notEqual(result.artifact_namespace, next.artifact_namespace);
  assert.notEqual(result.audit_path, next.audit_path);
});

test("reject invalid task port, run identity, source SHA, backend identity, or baseline", () => {
  for (const port of [0, 80, 3395, 18443, 65536, NaN, 3396.5])
    assert.throws(
      () => prepareCurrentRuntimeContract(template, { ...input, port }),
      /port/u,
    );
  for (const runId of ["../x", "x/other", "UPPER", "a", "a".repeat(60)])
    assert.throws(
      () => prepareCurrentRuntimeContract(template, { ...input, runId }),
      /run ID/u,
    );
  assert.throws(
    () =>
      prepareCurrentRuntimeContract(template, {
        ...input,
        framerailSourceSha: "invalid",
      }),
    /expected_runtime_source_sha256/u,
  );
  assert.throws(
    () =>
      prepareCurrentRuntimeContract(template, {
        ...input,
        backendRuntimeIdentity: { ...identity, image_id: "not-an-image" },
      }),
    /runtime/u,
  );
  assert.throws(
    () =>
      prepareCurrentRuntimeContract(
        { ...template, baseline_theme: { name: "Sigma-10" } },
        input,
      ),
    /Sigma-9/u,
  );
});

test("candidate_set_sha256 comes from the frozen set and is validated before a contract is built", () => {
  const seen = [];
  const bound = prepareCurrentRuntimeContract(template, {
    ...input,
    candidateSet: {
      root: candidateRoot,
      validate: (root, options) => {
        seen.push({ root, options });
        return [];
      },
    },
  });
  assert.equal(bound.candidate_set_sha256, FROZEN_SHA);
  assert.deepEqual(seen, [
    {
      root: candidateRoot,
      options: { expectedCandidateSetSha256: FROZEN_SHA, scope: "identity" },
    },
  ]);
});

test("refuse a run contract when the frozen candidate set does not validate", () => {
  assert.throws(
    () =>
      prepareCurrentRuntimeContract(template, {
        ...input,
        candidateSet: {
          root: candidateRoot,
          validate: () => ["frozen candidate-set identity is stale", "BHL authority is stale"],
        },
      }),
    /does not validate \(2 failures; first: frozen candidate-set identity is stale\)/u,
  );
});

test("refuse a frozen candidate set without a valid identity", () => {
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "theme-lab-contract-bad-"));
  fs.mkdirSync(path.join(badRoot, "publication"));
  fs.writeFileSync(
    path.join(badRoot, "publication", "frozen-candidate-set.json"),
    JSON.stringify({ candidate_set_sha256: "not-a-hash" }),
  );
  let calls = 0;
  assert.throws(
    () =>
      prepareCurrentRuntimeContract(template, {
        ...input,
        candidateSet: { root: badRoot, validate: () => ((calls += 1), []) },
      }),
    /no valid candidate_set_sha256/u,
  );
  assert.equal(calls, 0, "validation must not run on an unreadable identity");
  fs.rmSync(badRoot, { recursive: true, force: true });
});

test("the real frozen set is what validation sees by default", () => {
  // Without an injected validator the committed checkout is validated. The
  // builder must refuse exactly when the validator reports failures.
  const failures = validatePublicationCandidateSet(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ), { scope: "identity" });
  if (failures.length) {
    assert.throws(
      () => prepareCurrentRuntimeContract(template, { ...input, candidateSet: {} }),
      /does not validate/u,
    );
  } else {
    assert.equal(
      prepareCurrentRuntimeContract(template, { ...input, candidateSet: {} }).candidate_set_sha256,
      JSON.parse(fs.readFileSync(path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "publication",
        "frozen-candidate-set.json",
      ), "utf8")).candidate_set_sha256,
    );
  }
});

