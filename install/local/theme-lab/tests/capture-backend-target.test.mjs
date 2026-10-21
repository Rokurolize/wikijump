import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveCaptureBackendTarget } from "../src/capture-backend-target.mjs";

const repoRoot = "/work/checkout";
const runtime = "/work/runtime-checkout";
const project = "wikijump-theme-lab-basalt-current-20261022";
const portsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../ports/interactive-visual-fixture",
);

test("default capture measures this checkout's shared development backend", () => {
  assert.deepEqual(resolveCaptureBackendTarget({ repoRoot }), {
    root: repoRoot,
    identityOptions: undefined,
  });
});

test("task capture measures the task Deepwell container against the runtime checkout", () => {
  assert.deepEqual(
    resolveCaptureBackendTarget({
      runtimeRepo: runtime,
      backendProject: project,
      repoRoot,
    }),
    {
      root: runtime,
      identityOptions: {
        containerName: `${project}-deepwell-1`,
        composeProject: project,
      },
    },
  );
});

test("runtime repo and backend project must come together and be well formed", () => {
  assert.throws(
    () => resolveCaptureBackendTarget({ runtimeRepo: runtime, repoRoot }),
    /together/u,
  );
  assert.throws(
    () => resolveCaptureBackendTarget({ backendProject: project, repoRoot }),
    /together/u,
  );
  for (const bad of ["relative/path", "/work/../etc", "/work/runtime//x"])
    assert.throws(
      () =>
        resolveCaptureBackendTarget({
          runtimeRepo: bad,
          backendProject: project,
          repoRoot,
        }),
      /canonical absolute/u,
      bad,
    );
  for (const bad of [
    "wikijump-local-development",
    "wikijump-standing",
    "wikijump-theme-lab-A",
    "wikijump-theme-lab-a",
    "other",
  ])
    assert.throws(
      () =>
        resolveCaptureBackendTarget({
          runtimeRepo: runtime,
          backendProject: bad,
          repoRoot,
        }),
      /task-owned/u,
      bad,
    );
});

test("matrix forwards the task backend binding to every capture child", () => {
  const matrix = fs.readFileSync(path.join(portsDir, "capture-theme-matrix.mjs"), "utf8");
  const interactive = fs.readFileSync(path.join(portsDir, "capture-interactive.mjs"), "utf8");
  assert.equal((matrix.match(/--runtime-repo=\$\{runtimeRepoArg\}/gu) ?? []).length, 2);
  assert.equal((matrix.match(/--backend-project=\$\{backendProjectArg\}/gu) ?? []).length, 2);
  assert.match(interactive, /readRunningDeepwellRuntimeIdentity\(backendTarget\.root,backendTarget\.identityOptions\)/u);
});
