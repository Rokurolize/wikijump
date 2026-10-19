import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createDeepwellRuntimeIdentity } from "../src/deepwell-runtime-identity.mjs";
import { prepareCurrentRuntimeContract } from "../src/current-runtime-contract-builder.mjs";

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
const input = {
  runId: "basalt-source-20261019",
  port: 3396,
  framerailSourceSha: "a".repeat(64),
  backendRuntimeIdentity: identity,
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
  assert.equal(result.candidate_set_sha256, template.candidate_set_sha256);
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
