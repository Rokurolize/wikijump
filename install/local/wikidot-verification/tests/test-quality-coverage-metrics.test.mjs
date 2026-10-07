import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

import {summarizeLlvmCoverage, summarizeRawV8Coverage} from "../../../../scripts/test-quality-coverage-metrics.mjs";

const metric = (count, covered) => ({count, covered, percent: count ? 100 * covered / count : 0});
const entry = (filename, lines) => ({
  filename,
  summary: {
    lines: metric(...lines),
    functions: metric(2, 1),
    regions: metric(10, 4),
    instantiations: metric(3, 1),
  },
});

test("LLVM coverage metrics include only scoped production source, not test files", () => {
  const report = {data: [{files: [
    entry("/checkout/deepwell/src/example.rs", [10, 4]),
    entry("/checkout/deepwell/src/other.rs", [20, 10]),
    entry("/checkout/deepwell/tests/example.rs", [400, 400]),
  ]}]};
  const summary = summarizeLlvmCoverage(report, {
    sourcePrefix: "/checkout/deepwell/src",
    expectedFiles: ["example.rs", "other.rs", "noninstrumented.rs"],
  });
  assert.deepEqual(summary.metrics.lines, {count: 30, covered: 14, percent: 46.67});
  assert.deepEqual(summary.metrics.functions, {count: 4, covered: 2, percent: 50});
  assert.deepEqual(summary.not_instrumented_or_not_emitted, ["noninstrumented.rs"]);
  assert.equal(summary.instrumented_file_count, 2);
  assert.equal(summary.top_uncovered[0].path, "other.rs");
  assert.match(summary.top_uncovered[0].classification, /unreviewed/u);
  assert.match(summary.branch_metric.status, /unavailable/u);
});

test("LLVM coverage rejects duplicated or contradictory file metrics", () => {
  const file = entry("/checkout/deepwell/src/example.rs", [10, 4]);
  const args = {sourcePrefix: "/checkout/deepwell/src"};
  assert.throws(() => summarizeLlvmCoverage({data: [{files: [file, file]}]}, args), /duplicated file identity/u);
  assert.throws(() => summarizeLlvmCoverage({data: [{files: [
    entry("/checkout/deepwell/src/bad.rs", [2, 3]),
  ]}]}, args), /invalid lines/u);
  assert.throws(() => summarizeLlvmCoverage({files: []}, args), /no data array/u);
});

test("Node V8 ranges never stand in for source line or branch coverage", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wj-v8-metrics-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  writeFileSync(join(directory, "coverage-a.json"), JSON.stringify({result: [
    {url: "file:///checkout/framerail/src/a.js", functions: [
      {ranges: [{count: 1}]}, {ranges: [{count: 0}]},
    ]},
    {url: "file:///checkout/framerail/src/inventory-omitted-test.js", functions: [{ranges: [{count: 1}]}]},
    {url: "file:///checkout/framerail/tests/fixture.js", functions: [{ranges: [{count: 1}]}]},
  ]}));
  const summary = summarizeRawV8Coverage(directory, {
    sourcePrefix: "/checkout/framerail/src", expectedFiles: ["a.js", "unobserved.js"],
  });
  assert.deepEqual(summary.function_entry_ranges, {count: 2, covered: 1});
  assert.deepEqual(summary.not_instrumented_or_not_emitted, ["unobserved.js"]);
  assert.equal(summary.instrumented_file_count, 1);
  assert.match(summary.source_lines_and_branches, /unavailable/u);
});

test("Node V8 summary fails closed on missing or malformed raw profiles", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wj-v8-empty-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  assert.throws(() => summarizeRawV8Coverage(directory, {sourcePrefix: "/checkout/framerail/src"}), /No Node V8 raw/u);
  writeFileSync(join(directory, "coverage-invalid.json"), JSON.stringify({unexpected: []}));
  assert.throws(() => summarizeRawV8Coverage(directory, {sourcePrefix: "/checkout/framerail/src"}), /no result array/u);
});
