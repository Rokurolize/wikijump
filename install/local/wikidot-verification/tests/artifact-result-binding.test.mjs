import assert from "node:assert/strict";
import test from "node:test";
import {
  assertArtifactKind,
  validateArtifactResult,
} from "../src/artifact-result-validator.mjs";

function codexResult(overrides = {}) {
  return {
    schema_version: 1,
    status: "analysis_complete",
    repository: "Rokurolize/wikijump",
    task_id: "WJ-OPS-001",
    assignment_id: "WJ-OPS-001-r1-a1",
    artifacts: ["report.md"],
    validation: [],
    ...overrides,
  };
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

test("artifact result rejects bindings to another task or assignment", () => {
  const findings = [];
  validateArtifactResult({
    kind: "codex",
    result: codexResult({task_id: "WJ-OPS-999", assignment_id: "WJ-OPS-999-r9-a9"}),
    findings,
    expectedTaskId: "WJ-OPS-001",
    expectedAssignmentId: "WJ-OPS-001-r1-a1",
  });
  assert.deepEqual(codes(findings), [
    "result_task_id_mismatch",
    "result_assignment_id_mismatch",
  ]);
  const [taskMismatch, assignmentMismatch] = findings;
  assert.equal(taskMismatch.path, "result.json");
  assert.equal(taskMismatch.expected, "WJ-OPS-001");
  assert.equal(taskMismatch.actual, "WJ-OPS-999");
  assert.equal(assignmentMismatch.expected, "WJ-OPS-001-r1-a1");
  assert.equal(assignmentMismatch.actual, "WJ-OPS-999-r9-a9");
});

test("artifact result skips binding checks without expectations", () => {
  const findings = [];
  validateArtifactResult({
    kind: "codex",
    result: codexResult(),
    findings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(findings, []);
});

test("artifact result reports missing codex identity fields", () => {
  const findings = [];
  validateArtifactResult({
    kind: "codex",
    result: {
      schema_version: 1,
      status: "analysis_complete",
      artifacts: [],
      validation: [],
    },
    findings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(codes(findings), [
    "result_repository_missing",
    "result_task_id_missing",
    "result_assignment_id_missing",
  ]);
});

test("artifact result rejects non-object results and unknown statuses", () => {
  const notObject = [];
  validateArtifactResult({
    kind: "codex",
    result: "not-an-object",
    findings: notObject,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(codes(notObject), ["result_not_object"]);

  const badStatus = [];
  validateArtifactResult({
    kind: "codex",
    result: codexResult({status: "strategy_ready"}),
    findings: badStatus,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.ok(codes(badStatus).includes("result_status_unknown"));
});

test("artifact result drops unsafe artifact references but keeps safe ones", () => {
  const findings = [];
  const validated = validateArtifactResult({
    kind: "codex",
    result: codexResult({
      artifacts: [
        "reports/result.json",
        "/absolute/evil.md",
        "../escape.md",
        "back\\slash.md",
        {path: "nested/ok.md"},
        {path: "../nested-escape.md"},
      ],
    }),
    findings,
    expectedTaskId: "WJ-OPS-001",
    expectedAssignmentId: "WJ-OPS-001-r1-a1",
  });
  assert.deepEqual(validated.artifactPaths, ["reports/result.json", "nested/ok.md"]);
  assert.deepEqual(
    codes(findings),
    Array(4).fill("artifact_reference_path_invalid"),
  );
});

test("artifact result validates pro outputs and patch identity", () => {
  const strategyFindings = [];
  validateArtifactResult({
    kind: "pro",
    result: {schema_version: 1, status: "strategy_ready", repository: "r"},
    findings: strategyFindings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(codes(strategyFindings), ["pro_outputs_missing"]);

  const patchFindings = [];
  validateArtifactResult({
    kind: "pro",
    result: {
      schema_version: 1,
      status: "patch_ready",
      outputs: ["patch.diff"],
    },
    findings: patchFindings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(codes(patchFindings), [
    "result_repository_missing",
    "result_task_id_missing",
    "result_base_commit_missing",
  ]);
});

test("artifact result rejects non-object pro results", () => {
  const findings = [];
  validateArtifactResult({
    kind: "pro",
    result: 42,
    findings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.deepEqual(codes(findings), ["result_not_object"]);
});

test("artifact result warns on codex results without validation records", () => {
  const findings = [];
  validateArtifactResult({
    kind: "codex",
    result: codexResult({validation: undefined}),
    findings,
    expectedTaskId: "WJ-OPS-001",
    expectedAssignmentId: "WJ-OPS-001-r1-a1",
  });
  assert.deepEqual(codes(findings), ["result_validation_missing"]);
  assert.equal(findings[0].severity, "warning");
});

test("artifact kind detection falls back to pro without an assignment id", () => {
  assert.doesNotThrow(() => assertArtifactKind("auto"));
  const findings = [];
  const validated = validateArtifactResult({
    kind: "auto",
    result: {
      schema_version: 1,
      status: "patch_ready",
      repository: "r",
      task_id: "t",
      base_commit: "c",
    },
    findings,
    expectedTaskId: null,
    expectedAssignmentId: null,
  });
  assert.equal(validated.artifactKind, "pro");
  assert.deepEqual(findings, []);
});
