import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planChangeImpactFromRepository,
  planThemeLabChanges,
} from "../src/change-impact-plan.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const plan = (files) => planChangeImpactFromRepository(repo, files);

test("docs and named test code need test checks but do not assert a new runtime has passed", () => {
  const result = plan([
    "docs/agents/theme-lab.md",
    "install/local/theme-lab/tests/change-impact-plan.test.mjs",
  ]);
  assert.equal(result.scope, "code-free");
  assert.deepEqual(result.mandatory_themes, []);
  assert.equal(result.authority, "planning_only_not_current_acceptance");
  assert.equal(result.estimated_canonical_rows, 0);
});

test("Basalt candidate updates prioritize Basalt without skipping other theme regressions", () => {
  const result = plan([
    "install/local/theme-lab/ports/basalt/candidate.wikidot.source.txt",
  ]);
  assert.equal(result.scope, "full");
  assert.equal(result.mandatory_themes.length, 36);
  assert.ok(result.advisory_priority_themes.includes("basalt"));
  assert.equal(result.estimated_canonical_rows, 5220);
  assert.ok(
    result.graph_coverage.missing.length > 0,
    "incomplete source graph must never authorize a narrow gate",
  );
});

test("Black Highlighter theme update includes known downstream dependent themes in priority order", () => {
  const result = plan([
    "install/local/theme-lab/ports/black-highlighter-theme/candidate.css",
  ]);
  assert.equal(result.scope, "full");
  for (const name of [
    "black-highlighter-theme",
    "isolated-terminal",
    "extra-black-highlighter-theme",
  ]) {
    assert.ok(
      result.advisory_priority_themes.includes(name),
      `missing known dependent ${name}`,
    );
  }
});

test("global renderer, parser, policy, unknown, shared assets, and fixtures all fail closed", () => {
  const cases = [
    "framerail/src/lib/server/load/page/page-presentation.ts",
    "deepwell/src/render/ftml.rs",
    "install/local/theme-lab/src/visual-gate.mjs",
    "install/local/theme-lab/ports/current-acceptance/visual-gate-policy.json",
    "install/local/theme-lab/ports/shared-replay-assets/example.png",
    "install/local/theme-lab/ports/basalt/fixture.json",
    "a-new-unknown-directory/a.file",
    ".github/workflows/theme-lab.yaml",
  ];
  for (const file of cases) {
    const result = plan([file]);
    assert.equal(result.scope, "full", file);
    assert.equal(result.mandatory_themes.length, 36, file);
  }
});

test("malformed paths cannot bypass the full-run requirement", () => {
  for (const file of [
    "../src/file",
    "install\\local\\theme-lab\\README.md",
    "/tmp/README.md",
    "C:/outside/README.md",
    "foo//README.md",
  ]) {
    const result = plan([file]);
    assert.equal(result.scope, "full", file);
    assert.equal(result.mandatory_themes.length, 36, file);
  }
});

test("same path repeated is deduplicated; no change is advisory no-op", () => {
  assert.equal(plan([]).scope, "no-changes");
  const result = plan([
    "install/local/theme-lab/ports/basalt/candidate.css",
    "install/local/theme-lab/ports/basalt/candidate.css",
  ]);
  assert.equal(result.changed_paths.length, 1);
});

test("incomplete or mismatched fixture policy does not return a narrow plan", () => {
  const packages = Object.fromEntries(
    Array.from({ length: 36 }, (_, i) => [`theme${i}`, {}]),
  );
  for (const option of [
    {
      packages,
      upstreamGraph: [],
      visualPolicy: { counts: { V: 35, C: 76, M: 34 }, rows: [] },
    },
    {
      packages: {},
      upstreamGraph: [],
      visualPolicy: {
        counts: { V: 35, C: 76, M: 34 },
        rows: Array(145).fill({}),
      },
    },
  ])
    assert.throws(
      () => planThemeLabChanges(["docs/README.md"], option),
      /required|incomplete|unrecognized/u,
    );
});
