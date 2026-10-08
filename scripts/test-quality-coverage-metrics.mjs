import {readFileSync, readdirSync} from "node:fs";
import {resolve} from "node:path";

const LLVM_METRICS = ["lines", "functions", "regions", "instantiations"];

/** Compute source-scoped LLVM metrics; never conflate tests, generated code, or instrumentation gaps. */
export function summarizeLlvmCoverage(report, {sourcePrefix, expectedFiles = []} = {}) {
  if (!Array.isArray(report?.data)) throw new Error("LLVM coverage report has no data array");
  if (!sourcePrefix) throw new Error("LLVM coverage needs an explicit production-source prefix");
  const normalizedPrefix = sourcePrefix.replaceAll("\\", "/").replace(/\/$/u, "") + "/";
  const files = report.data.flatMap((item) => item.files ?? [])
    .filter((file) => file.filename?.replaceAll("\\", "/").startsWith(normalizedPrefix));
  const observed = new Set();
  const metrics = Object.fromEntries(LLVM_METRICS.map((name) => [name, {count: 0, covered: 0, percent: null}]));
  const uncovered = [];
  for (const file of files) {
    const name = file.filename.replaceAll("\\", "/").slice(normalizedPrefix.length);
    if (observed.has(name)) throw new Error(`LLVM coverage duplicated file identity: ${name}`);
    observed.add(name);
    for (const metric of LLVM_METRICS) {
      const entry = file.summary?.[metric];
      if (!entry || !Number.isSafeInteger(entry.count) || !Number.isSafeInteger(entry.covered)
          || entry.count < 0 || entry.covered < 0 || entry.covered > entry.count) {
        throw new Error(`LLVM coverage missing or invalid ${metric} for ${name}`);
      }
      metrics[metric].count += entry.count;
      metrics[metric].covered += entry.covered;
    }
    const lines = file.summary.lines;
    if (lines.count > lines.covered) {
      uncovered.push({path: name, uncovered_lines: lines.count - lines.covered,
        total_lines: lines.count, covered_lines: lines.covered,
        classification: "unreviewed: ownership or instrumentation needs inspection"});
    }
  }
  for (const metric of LLVM_METRICS) {
    const item = metrics[metric];
    item.percent = item.count === 0 ? null : Number((100 * item.covered / item.count).toFixed(2));
  }
  const notObserved = expectedFiles.filter((name) => !observed.has(name)).sort();
  uncovered.sort((a, b) => b.uncovered_lines - a.uncovered_lines || a.path.localeCompare(b.path));
  return {
    measurement: "LLVM source-scoped line/function/region/instantiation instrumentation",
    instrumented_file_count: observed.size,
    declared_source_file_count: expectedFiles.length,
    not_instrumented_or_not_emitted: notObserved,
    metrics,
    top_uncovered: uncovered.slice(0, 30),
    uncovered_file_count: uncovered.length,
    branch_metric: {status: "unavailable on stable Rust; use mutation or independent branch evidence"},
  };
}

/** Raw Node V8 ranges are not equivalent to source lines or branch coverage. */
export function summarizeRawV8Coverage(directory, {sourcePrefix, expectedFiles = []} = {}) {
  const prefix = `file://${sourcePrefix.replaceAll("\\", "/").replace(/\/$/u, "")}/`;
  const eligible = expectedFiles.length ? new Set(expectedFiles) : null;
  const observed = new Set();
  const rawFiles = readdirSync(directory).filter((name) => /^coverage-.*\.json$/u.test(name));
  if (rawFiles.length === 0) throw new Error(`No Node V8 raw coverage profiles in ${directory}`);
  let scripts = 0;
  let functions = 0;
  let hitFunctions = 0;
  for (const rawFile of rawFiles) {
    const report = JSON.parse(readFileSync(resolve(directory, rawFile), "utf8"));
    if (!Array.isArray(report.result)) throw new Error(`Node V8 profile has no result array: ${rawFile}`);
    for (const item of report.result) {
      if (!item.url?.startsWith(prefix)) continue;
      const name = decodeURIComponent(item.url.slice(prefix.length));
      if (eligible && !eligible.has(name)) continue;
      observed.add(name);
      scripts += 1;
      for (const fn of item.functions ?? []) {
        functions += 1;
        if (fn.ranges?.[0]?.count > 0) hitFunctions += 1;
      }
    }
  }
  return {
    measurement: "raw Node V8 executed function ranges; not line, branch, or Vite SSR coverage",
    raw_profile_files: rawFiles.length,
    observed_script_records: scripts,
    instrumented_file_count: observed.size,
    declared_source_file_count: expectedFiles.length,
    not_instrumented_or_not_emitted: expectedFiles.filter((name) => !observed.has(name)).sort(),
    function_entry_ranges: {count: functions, covered: hitFunctions},
    source_lines_and_branches: "unavailable from these raw profiles",
  };
}
