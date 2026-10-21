import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateCoverageWithIncludeErrors,
  buildIncludeErrorBodiesQuery,
  buildIncludeErrorRootsQuery,
  findIncludeErrorTargets,
  hasIncludeError,
} from "../src/corpus-include-errors.mjs";
import {
  parseArgs,
  usage,
} from "../scripts/verify-corpus-import-integrity.mjs";

test("include errors extract targets from the entity-escaped compiled form", () => {
  const body =
    '<div class="error-block">Included page &quot;component:preview&quot; does not exist ' +
    '(<a href="/component:preview/edit/true">create it now</a>)</div>';
  assert.deepEqual(findIncludeErrorTargets(body), ["component:preview"]);
  assert.equal(hasIncludeError(body), true);
});

test("include errors extract targets from the raw-quote text form", () => {
  assert.deepEqual(
    findIncludeErrorTargets(
      'Included page "scp-999" does not exist (create it now)',
    ),
    ["scp-999"],
  );
  assert.deepEqual(
    findIncludeErrorTargets(
      'Included page "theme:basalt" does not exist ([[a href="http://x/edit/true"]]create it now[[/a]])',
    ),
    ["theme:basalt"],
  );
});

test("include errors collect distinct targets in first-seen order", () => {
  const body =
    "Included page &quot;a&quot; does not exist (<a>x</a>) " +
    'Included page "b" does not exist (y) ' +
    "Included page &quot;a&quot; does not exist (<a>x</a>)";
  assert.deepEqual(findIncludeErrorTargets(body), ["a", "b"]);
});

test("story prose and unrelated product messages are not include errors", () => {
  assert.deepEqual(
    findIncludeErrorTargets(
      "There does not exist a single mote of evidence here.",
    ),
    [],
  );
  assert.deepEqual(
    findIncludeErrorTargets("Requested forum category does not exist."),
    [],
  );
  assert.deepEqual(
    findIncludeErrorTargets('Included page "scp-173" exists.'),
    [],
  );
  assert.equal(
    hasIncludeError("A page about things that do not exist."),
    false,
  );
});

test("roots query uses the exact marker regex instead of a loose LIKE", () => {
  const query = buildIncludeErrorRootsQuery(6000006);
  assert.match(query, /p\.site_id = 6000006/);
  assert.match(query, /compiled_body_html_hash/);
  assert.match(query, /~\s*'Included page/);
  assert.doesNotMatch(query, /LIKE '%does not exist%'/);
  assert.throws(() => buildIncludeErrorRootsQuery("6000006"), /integer/);
});

test("bodies query escapes slugs and orders deterministically", () => {
  const query = buildIncludeErrorBodiesQuery(6000006, [
    "scp-'173",
    "scp-173",
    "scp-'173",
  ]);
  assert.match(query, /scp-''173/);
  assert.match(query, /ORDER BY requested\.slug/);
  assert.throws(
    () => buildIncludeErrorBodiesQuery(6000006, []),
    /at least one slug/,
  );
});

test("coverage annotation fails only gapless pages that still render errors", () => {
  const report = {
    status: "pass",
    pages: [
      {
        slug: "fixed-page",
        missing_dependency_count: 0,
        gap_count: 0,
        truncated_count: 0,
      },
      {
        slug: "gapped-page",
        missing_dependency_count: 0,
        gap_count: 2,
        truncated_count: 0,
      },
      {
        slug: "clean-page",
        missing_dependency_count: 0,
        gap_count: 0,
        truncated_count: 0,
      },
    ],
    failures: [],
  };
  const bodies =
    "fixed-page|before Included page &quot;component:x&quot; does not exist (<a>y</a>) after\n" +
    'gapped-page|Included page "component:y" does not exist (create it now)\n' +
    "clean-page|no errors here\n";
  const annotated = annotateCoverageWithIncludeErrors(report, bodies);
  assert.equal(annotated.status, "fail");
  assert.deepEqual(
    annotated.pages.find((page) => page.slug === "fixed-page")
      .include_error_targets,
    ["component:x"],
  );
  assert.deepEqual(
    annotated.pages.find((page) => page.slug === "gapped-page")
      .include_error_targets,
    ["component:y"],
  );
  assert.deepEqual(annotated.failures, [
    {
      slug: "fixed-page",
      reason: "unexpected_include_errors",
      targets: ["component:x"],
    },
  ]);
});

test("coverage annotation rejects malformed body rows", () => {
  const report = { status: "pass", pages: [], failures: [] };
  assert.throws(
    () => annotateCoverageWithIncludeErrors(report, "no-separator-here"),
    /malformed row/,
  );
});

test("verify tool accepts the include-error certification flag", () => {
  const args = parseArgs([
    "--manifest",
    "m.jsonl",
    "--cross-site-coverage",
    "--attribution",
    "a.json",
    "--check-include-errors",
  ]);
  assert.equal(args.checkIncludeErrors, true);
  assert.match(usage(), /--check-include-errors/);
});
